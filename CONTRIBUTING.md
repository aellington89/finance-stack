# Contributing to Finance Stack

Welcome. This document codifies the conventions, workflow, and release process
used in this repo. It's a thin guide — see [docs/](docs/README.md) for deep
dives on specific topics.

## Local development

Follow the [Getting Started](README.md#getting-started) section in the root
README to get the stack running (`docker compose up`). For Next.js local
development (outside Docker), see [app/README.md](app/README.md), which lists
all npm scripts (dev server, lint, typecheck, test, db:*). For the test
database setup, see [docs/database.md](docs/database.md).

The app requires sign-in ([docs/auth.md](docs/auth.md)): set `AUTH_SECRET` in
`app/.env.local` (`openssl rand -base64 33`) and create a dev user with
`npm run auth:create-user -- <username>` before using the UI.

## Branching & pull requests

- **`master`** is the primary branch; all PRs target it.
- **`test`** is the working branch, and day-to-day development happens directly
  on it. There is no branch per issue — create one only when a change
  specifically warrants isolation (a risky refactor you may want to abandon, or
  work that would collide with something already in flight on `test`).
- Commit to `test`, `git push origin test`, then open a PR from `test` into
  `master`. CI runs on the push *and* on the PR; all gates must be green before
  merging (see [CI gates](#ci-gates) below).

## Commit messages

Format: **`Issue #N - <short imperative>`**

```
Issue #150 - Centralize date-range validation
Issue #155 - Add CI gate: SEED_REFERENCES names must match shared-lookups.sql
Issue #174 - Add CONTRIBUTING.md (dev workflow, conventions, release process)
```

Every commit that closes or advances an issue should carry the issue number.
The `(#N)` trailing-reference form (e.g. `Clean up .gitignore files (#154)`)
is tolerated by the release-notes generator but is not preferred — use the
`Issue #N -` prefix for consistency.

## CI gates

CI runs on every push to `master`/`test` and on all PRs. There are five gates
that can fail a build before lint and tests even run, plus an image-scan gate
that runs in a parallel job; all are fast to satisfy locally:

### Schema-drift gate

Fails if `app/drizzle/schema.ts` has been edited without a matching migration.

**Fix:** from `app/`:

```sh
npm run db:generate -- --name <short-description>
```

Commit `schema.ts` and the generated migration together in the same PR. See
[docs/schema-changes.md](docs/schema-changes.md) for the full workflow,
including the **immutable-migration rule** (never hand-edit an applied `.sql`
file — ship a follow-on migration instead).

### Seed-reference gate

Two assertions over `init-db/seeds/shared-lookups.sql`:

1. Every entry in `app/lib/constants/reference-ids.ts` (`SEED_REFERENCES`
   table/id/name tuples) matches a row in the seed.
2. Every statement in the seed is additive and safe to re-run — `INSERT … ON
   CONFLICT DO NOTHING`, `SELECT setval(…)`, `UPDATE … WHERE <guard>`. No
   `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `ON CONFLICT DO UPDATE`, or unguarded
   `UPDATE`.

The second exists because the migrate service applies that file to the **live
`Finances` database on every run**, not just to an empty one (Issue #187) — so
anything destructive added there reaches real user data on the next
`docker compose up`. CI pairs this static check with a behavioural **reference
backfill gate** that drops a canonical row from a populated throwaway database,
re-applies the seed, and asserts the row returns with user data untouched.

**Fix:** run locally, then keep the two files in sync:

```sh
cd app && npm run check:seed-references
```

### Role privilege gate

Fails if the database service roles don't hold exactly the privileges
`init-db/roles/02-grants.sql` is meant to establish — too few or too many. Most
often tripped by a migration that adds a table or view the narrow
`finance_importer` / `finance_bi` roles need, since those grants are
enumerated by hand (`finance_app` is covered automatically).

A second way to trip it: bringing a table into the audit set
([docs/audit-log.md](docs/audit-log.md)). The trigger itself needs no grant — it
is `SECURITY DEFINER` — but a new *view* over the log does, and `audit_log` must
stay `SELECT`-only for `finance_app` in both `02-grants.sql` and
`assert-grants.sql` or the negative assertions fail.

**Fix:** update `init-db/roles/02-grants.sql`, then verify against a running
stack:

```sh
docker compose run --rm --entrypoint bash migrate /scripts/verify-db-roles.sh Finances_Test
```

See [Roles & Privileges](docs/database.md#roles--privileges).

### Changelog gate

Fails if `app/package.json` version doesn't equal the newest released version
in `CHANGELOG.md`, or (on a `v*` tag push) if the tag isn't a well-formed
`vX.Y.Z` matching that version.

**Fix:** run locally before pushing:

```sh
cd app && npm run check:changelog
```

If you're not cutting a release, simply ensure you haven't accidentally bumped
`package.json` without also closing the `CHANGELOG.md` section.

### Docs index gate

Every guide in `docs/` is indexed in two hand-maintained lists — `## Guides` in
[docs/README.md](docs/README.md) and `## Documentation` in
[README.md](README.md) — and this fails if either list has fallen behind the
directory, in either direction: a guide nothing links to, or a link to a guide
that no longer exists.

**Fix:** add or remove the entry in **both** lists, following the existing
`- [Title](path) — description` format, then:

```sh
cd app && npm run check:docs
```

Only links inside the list sections count. The root README links several guides
from its prose as well, and a prose link does not make a guide indexed — that is
exactly how `docs/secrets.md` came to be linked twice from the README body while
missing from its Documentation list entirely (Issue #186).

### Dependency audit gate

Two steps, **both blocking**. Either fails if a dependency carries a HIGH or
CRITICAL advisory:

```sh
cd app
npm audit --omit=dev --audit-level=high   # runtime — ships inside the image
npm audit --audit-level=high              # the full tree, dev deps included
```

The second subsumes the first, and the split is kept because *which one* goes
red is the diagnosis. Runtime red means the advisory ships to users; build-time
red means it is confined to the toolchain. Same fix procedure, different urgency.

**Fix**, in order of preference:

1. **Bump it** — `npm update <pkg>`, then re-run the audit. This is the common
   case even for transitives, because most advisories are patched within a range
   the lockfile already resolves. Check `npm view <pkg> versions` against the
   advisory's affected range before assuming a bump is unavailable: Issue #194
   was open for months on the belief that the eslint dev tree needed `eslint@10`,
   when four of its HIGH advisories were cleared by a plain lockfile refresh.
2. **Override it** — if the only fix is a major bump, or the package is vendored
   by a dependency (as with next's bundled `postcss` and `sharp`), add an entry
   to `overrides` in `app/package.json` **and** explain it in the `//overrides`
   note alongside. The note is not optional; an unexplained override is
   indistinguishable from a stale one.
3. **There is no third option yet.** If an advisory has no fix at all — `npm
   audit` says a fix requires a breaking downgrade, or names no fix — the gate
   goes red and stays red. `npm audit` has no per-advisory allowlist, so there
   is no equivalent of [`.trivyignore`](.trivyignore) here. Raise it rather than
   working around it: the answer is either dropping the dependency or building
   that allowlist, and both are decisions worth making deliberately.

Run the audits before pushing. A red gate on `master` is inherited by every open
Dependabot PR, which is exactly the state in which a real regression on one of
them gets waved through as "the usual red".

### Image scan gate

Runs in the parallel `image` job: builds the production image the same way
`release.yml` does (`docker compose build finance-app`), then scans it with
Trivy. Fails on HIGH/CRITICAL findings **that have a fix available**.

**Fix**, in order of preference:

1. **Remove the vulnerable component** if the image doesn't need it. The runner
   stage deletes npm, npx, yarn and corepack for exactly this reason — the
   standalone server runs `node server.js` and never installs a package, and
   npm's vendored dependencies were contributing 1 CRITICAL and 5 HIGH findings
   that no application-level bump could clear.
2. **Rebuild on a patched base image** (bump `node:24-alpine` in
   `app/Dockerfile`).
3. **Suppress, with an expiry.** Add a dated, justified entry to
   [`.trivyignore`](.trivyignore) — the file documents the required format.

Note that Trivy scans the whole image, not just `app/package.json`, so findings
can come from the base image rather than from anything this repo declares. Check
the reported path before assuming a dependency bump will help.

Reproduce locally (pinned, for the same supply-chain reason the actions are):

```sh
docker compose build finance-app
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$(pwd)/.trivyignore:/.trivyignore:ro" \
  aquasec/trivy:0.72.0 image --severity HIGH,CRITICAL --ignore-unfixed \
  --exit-code 1 --ignorefile /.trivyignore finance-app:latest
```

If `docker compose build` can't find `CHANGELOG.md`, set
`CHANGELOG_CONTEXT="$(pwd)"` — the `changelog` additional build context needs an
absolute path on some Compose/buildx versions.

### Lint and tests

After the gates pass, CI runs:

```sh
npm run lint
npm run test:unit
npm run test:integration   # requires the Finances_Test database
```

See [docs/testing.md](docs/testing.md) for the unit/integration split and how
to point integration tests at the right database.

**`no-console` is enforced** over `app/`, `lib/`, `components/` and `hooks/`
(Issue #129). Application code logs through `lib/log.ts`, which emits one line
of JSON per record; a bare `console.*` is unparseable downstream and carries no
route/action/user context. Use `log.info(...)`, `reportError(err, ctx)`, or —
inside a server action's catch block — `actionFailure(name, err, message)`.
`scripts/` and `tests/` are exempt: console output *is* the interface of a CLI
like `check-changelog.ts`. Before adding a log call, read the redaction section
of [docs/observability.md](docs/observability.md) — drizzle puts every bound
query parameter in the error message, so logging a raw error leaks the row.

**`sql.raw` is banned** over the same four directories (Issue #179). It splices
its argument into the SQL text unescaped, which is the one way a value can
reach a query as syntax rather than as a parameter. Bind the value with
`${…}`, use `sql.identifier()` for an identifier, `valueList()` for an
`IN (…)` list, or build a static ``sql`` `` fragment — the rule has no
exceptions because every prior use had one of those equivalents. Note that
`date_trunc()`, `to_char()` and `generate_series()` all accept their unit,
format and step as bound parameters.

Adding a server action also means adding a row to the checklist in
[docs/input-validation.md](docs/input-validation.md) and to the registry in
`tests/integration/actions/validation-contract.test.ts` — the test parses that
table and asserts the two match the modules' exports, so an uncovered action
fails CI.

**Real credentials only ever live in `.env` and `app/.env.local`** (Issue #181).
Both are gitignored by a `.env*` glob and excluded from the Docker build
contexts; the committed templates carry `changeme` placeholders and nothing
else. Never put a working value in `.env.example`, `app/.env.local.example`,
`docker-compose.yml`, or a workflow — a CI-only value is fine, but name it as
one (`ci-app-pw`, `release-smoke-test-only-secret`) so the next reader does not
have to guess. Two gates enforce this: `tests/unit/ignore-coverage.test.ts`
asserts the ignore rules still cover every `.env*` variant, and
[`secret-scan.yml`](.github/workflows/secret-scan.yml) runs gitleaks over the
commits you push and over the full history weekly. See
[docs/secrets.md](docs/secrets.md).

## Dependabot PRs

[`.github/dependabot.yml`](.github/dependabot.yml) watches five ecosystems
weekly:

| Ecosystem | Watches |
| --- | --- |
| `npm` | `app/package.json` |
| `pip` | `importer/requirements.txt` |
| `docker` | base images in `app/Dockerfile` |
| `docker-compose` | service images in `docker-compose.yml` |
| `github-actions` | workflow actions (SHA pins) |

Two things to know when reviewing these:

- **They don't follow the `Issue #N -` commit convention.** Dependabot can't
  know the issue number, so its PRs are the one accepted exception. Everything
  else applies — all gates must be green, and a user-visible bump still needs a
  `CHANGELOG.md` entry.
- **Actions are pinned by commit SHA, not tag.** Dependabot rewrites the SHA and
  its trailing `# vX.Y.Z` comment together. Never "simplify" a pin back to a
  mutable tag: on 19 March 2026 an attacker force-pushed malware over
  `aquasecurity/trivy-action`'s existing tags, which is precisely the action this
  repo's image scan depends on. The SHA is the thing that makes that survivable.

Bumping `postgres` in `docker-compose.yml` also needs a manual bump of the
`postgres:` service image in `.github/workflows/ci.yml` and
`backup-smoke.yml` — Dependabot does not read workflow service containers.

## Changelog entries (day-to-day)

Every PR that ships user-visible changes should add a bullet under
`## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) — in the appropriate
subsection (`Added`, `Changed`, `Fixed`, or `Security`) — with an issue link:

```markdown
## [Unreleased]

### Added
- Short description of the change ([Issue #N](https://github.com/aellington89/finance-stack/issues/N))
```

Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

## Schema changes

Edit `app/drizzle/schema.ts`, generate a migration, and commit both in one PR.
The full procedure — including FK changes in `relations.ts`, reviewing generated
SQL, and adopting migrations on an existing database — is in
[docs/schema-changes.md](docs/schema-changes.md).

## Releases

Releasing closes the `CHANGELOG.md` section, bumps the version, and pushes an
annotated `vX.Y.Z` git tag. **Pushing that tag is the release** — it fires
[`.github/workflows/release.yml`](.github/workflows/release.yml), which runs the
version/tag-consistency gate, builds the stamped image, boots the full stack and
verifies `/api/health`, then slices the `CHANGELOG.md` section and publishes the
GitHub Release. **There is still no registry push** — the image is built and
verified in CI, and never pushed anywhere.

**Brief sequence** (full steps and tagging rules are in [docs/releases.md](docs/releases.md)):

1. **Draft changelog entries.** Run the release-notes generator for a suggested
   bump and a draft bullet list:

   ```sh
   cd app
   npm run release:notes -- <prev-tag>..HEAD --changelog
   ```

   The script prints a draft Keep-a-Changelog block (issue-linked bullets and a
   suggested minor/patch bump) to **stdout** — it does not edit any files.
   Re-sort the bullets into the correct `Added`/`Changed`/`Fixed`/`Security`
   subsections under `## [Unreleased]` in `CHANGELOG.md`.

2. **Close the changelog section.** In `CHANGELOG.md`, rename
   `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and open a fresh empty
   `## [Unreleased]` above it. Update the reference links at the bottom.

3. **Bump the version.** `cd app && npm version X.Y.Z --no-git-tag-version` —
   this keeps `package-lock.json` in step, which editing `app/package.json` by
   hand does not. The tag is created separately, in step 5.

4. **Commit.** E.g. `git commit -m "Release vX.Y.Z"`.

5. **Tag and push** (annotated), once the release commit is on `master`:

   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z — <one-line summary>"
   git push origin vX.Y.Z
   ```

   `release.yml` takes it from here and publishes the Release. Watch the run;
   if the gate rejects the tag, nothing is published and the tag can be
   deleted and re-pushed.

See [docs/releases.md](docs/releases.md) for the complete procedure, tagging
rules (`vX.Y.Z` — annotated, `v` prefix, no stray dots), and the local-fallback
`awk` snippet for slicing the release body out of `CHANGELOG.md` by hand if the
workflow is unavailable.
