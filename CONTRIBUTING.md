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
in `CHANGELOG.md`, if that release doesn't declare a valid `**Migration:**`
marker, or (on a `v*` tag push) if the tag isn't a well-formed `vX.Y.Z` matching
that version.

**Fix:** run locally before pushing:

```sh
cd app && npm run check:changelog
```

If you're not cutting a release, simply ensure you haven't accidentally bumped
`package.json` without also closing the `CHANGELOG.md` section.

**Migration marker** — every released section carries one line declaring how the
release can be rolled back
([#277](https://github.com/aellington89/finance-stack/issues/277)):

```markdown
## [0.3.0] - 2026-08-15

**Migration:** backward-compatible
```

`none` (no migration) · `backward-compatible` (the previous app version runs fine
against the new schema, so an image rollback suffices) · `breaking` (rolling back
requires restoring a pre-upgrade dump — there are no down migrations). The gate
requires the marker on the release being tagged and rejects an unrecognized value
anywhere, `[Unreleased]` included; `[Unreleased]` is not required to carry one.
Full guidance on picking a value is in [docs/releases.md](docs/releases.md).

### Deploy-bundle parity gate

The stack is described by two compose files: [docker-compose.yml](docker-compose.yml),
which builds from source for local development, and
[deploy/compose.yml](deploy/compose.yml), which is packed into the release
tarball and run on servers. This gate fails if they have diverged
([#227](https://github.com/aellington89/finance-stack/issues/227)).

**Exactly three differences are permitted**, and the gate asserts each rather
than ignoring it:

1. `build:` blocks — present only in the dev file
2. `image:` — the deploy file carries the `${IMAGE_REGISTRY}/…:${APP_VERSION}` prefix
3. `finance-app` ports — all interfaces in dev, `127.0.0.1` in deploy

Anything else — a resource limit, healthcheck, `depends_on` condition,
environment entry, profile or label — must match. It also compares the two
`.env.example` variable sets, which may differ only by `APP_VERSION` and
`IMAGE_REGISTRY`.

**Fix:** make the same edit in both files, then:

```sh
./scripts/check-deploy-parity.sh
```

The diff it prints is of the rendered `docker compose config` output, so it
points at the resolved value rather than the line you typed.

**`deploy/deploy.sh` needs no new variables here.** Its three overrides
(`DEPLOY_SKIP_PULL`, `DEPLOY_HEALTH_TIMEOUT`, `DEPLOY_HEALTH_URL`) configure the
script, not the stack, so they are plain environment variables documented in the
script header and the bundle README. Adding one to `deploy/.env.example` would
fail this gate, which allows exactly two deploy-only names.

### Deploy smoke

`.github/workflows/deploy-smoke.yml` runs `deploy/deploy.sh` end to end — first
install, a no-op re-run, then an upgrade that is deliberately made to fail its
health gate — and asserts each of the guarantees the script advertises
([#228](https://github.com/aellington89/finance-stack/issues/228)). It runs
weekly and on PRs touching the script, `deploy/compose.yml`, or the backup and
restore scripts it invokes.

The "bad release" costs nothing to maintain: `build.version` is inlined from
`app/package.json` at image build time, so the job tags the *same* image as
`9.9.9` and gets a container that starts, migrates and answers 200 while
reporting the wrong version — exactly the failure the health gate exists for.

A red job here usually means one of three things: the health poll no longer
combines its two conditions, `docker compose run` lost its `--no-deps` or
`--entrypoint` (which makes the backup gate start `migrate`, or hang on
`pg-backup`'s sleep loop), or a message the assertions grep for was reworded.
Shellcheck for the script lives in `backup-smoke.yml` with every other shell file
in the repo.

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

Runs in the parallel `image` job: builds all four service images the same way
`release.yml` does (`docker compose build finance-app migrate importer
pg-backup`), then scans each of them with Trivy. Fails on HIGH/CRITICAL findings
**that have a fix available**, in any of the four.

All four are scanned because all four are *published* — a `vX.Y.Z` tag pushes
each of them to GHCR ([Issue #226](https://github.com/aellington89/finance-stack/issues/226)),
so a base image nobody scanned is a base image a deployment host pulls. The four
scan steps run independently of each other's result, so one red image shows you
the other three's findings in the same run rather than across four.

**Fix**, in order of preference:

1. **Re-run the job.** This is genuinely first for `finance-importer` and
   `finance-backup`: their `python:3.14-slim` and `postgres:18.6` bases are
   rebuilt upstream under the same tag, so an OS-package finding often clears
   with no change in this repo at all.
2. **Remove the vulnerable component** if the image doesn't need it. The runner
   stage deletes npm, npx, yarn and corepack for exactly this reason — the
   standalone server runs `node server.js` and never installs a package, and
   npm's vendored dependencies were contributing 1 CRITICAL and 5 HIGH findings
   that no application-level bump could clear. (The `migrate` stage keeps npm
   deliberately — it runs `npx drizzle-kit` — so expect findings there that
   `finance-app` does not have.)
3. **Rebuild on a patched base image** — `node:24-alpine` in `app/Dockerfile`,
   `python:3.14-slim` in `importer/Dockerfile`. **`postgres` in
   `scripts/Dockerfile` is not free to move**: `pg_dump` must stay version-matched
   to the server, so bumping it means bumping `docker-compose.yml` and the
   `postgres:` service containers in both workflows in the same change.
4. **Suppress, with an expiry.** Add a dated, justified entry to
   [`.trivyignore`](.trivyignore) — the file documents the required format. Note
   that one file backs all four scans, so an entry silences its CVE everywhere.
   It is no longer empty: turning the gate on for the other three images required
   seeding ten base-image and bundled-tooling findings, and it currently holds
   fourteen. Read those before adding a fifteenth — yours may already be covered,
   as three of the four added in
   [#291](https://github.com/aellington89/finance-stack/issues/291) were by an
   entry already sitting there for the same fixed version.

   **Check step 1 before reaching for this, and say what you found.** An entry
   whose justification is "clears on an upstream rebuild" is only honest if the
   rebuild has not already happened. Docker Hub's
   `https://hub.docker.com/v2/repositories/library/<image>/tags/<tag>` reports
   `last_updated`; if that is older than the advisory, re-running the job cannot
   help and suppression is the right call. Record that in the entry.

**Stale suppressions are reported, not enforced.** Nothing removes an entry when
the base is finally rebuilt — the CVE stops being reported and the line stays,
still silencing that ID on all four images. `exp:` stops a suppression working
but does not delete it, and it fires months after the fact. So the `image` job
ends with `scripts/check-trivy-suppressions.sh`, which re-reads the images with
Trivy's `--show-suppressed` and emits a warning annotation for every entry that
no longer matches a finding anywhere. **It never fails the build** — a stale entry
is not a vulnerability, and a gate that goes red for tidiness is a gate people
stop reading.

**Act on what it reports only when it ran in CI**, and then delete the entry *and*
its comment. Run from a workstation it is advisory at best: it scans whatever
images that machine has built, and if their cached base layer is older than the
one CI pulls, packages present in CI's image are simply absent from yours — so
live suppressions look dead. That is not theoretical. In
[#291](https://github.com/aellington89/finance-stack/issues/291) exactly this
deleted two live entries on a local verdict (a three-week-stale
`python:3.14-slim`), and the gate went red on the next push. The script prints a
warning when `CI` is unset for this reason.

Two habits follow. Rebuild with `docker compose build --pull` before believing a
local run. And when checking a package by hand, look where it actually lives —
`setuptools` and `msgpack` are under `pip/_vendor/`, so listing the top level of
`site-packages` "confirms" an absence that isn't real.

If it ever warns that it **could not determine** which suppressions are live,
that is the fail-safe firing rather than a result: suppressed findings come back
under `ExperimentalModifiedFindings`, which is experimental and may be renamed by
a Trivy bump. Fix the script against the current output before trusting any
staleness verdict — the naive reading of a renamed field is "every entry is
stale", which is exactly the answer that would get live suppressions deleted.

**Two files are excluded from scanning outright**, via `skip-files` on the
`finance-migrate` and `finance-backup` steps: drizzle-kit's vendored `esbuild`
binary and the postgres image's `gosu`. Both are stripped third-party Go binaries
that nothing in this repo compiles, so Trivy attributes every Go stdlib advisory
to them and no fix ever arrives; suppressing them by CVE id would re-red the job
every few weeks without ever being actionable. Everything else in both images is
still scanned and still blocks. Do not widen those exclusions to a directory —
the point is that exactly two unfixable binaries are out of scope, not that
vendored code is.

Note that Trivy scans the whole image, not just `app/package.json`, so findings
can come from the base image rather than from anything this repo declares. Check
the reported path before assuming a dependency bump will help.

Reproduce locally (pinned, for the same supply-chain reason the actions are):

```sh
docker compose build finance-app migrate importer pg-backup

for img in finance-app finance-migrate finance-importer finance-backup; do
  echo "=== $img ==="
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$(pwd)/.trivyignore:/.trivyignore:ro" \
    aquasec/trivy:0.72.0 image --severity HIGH,CRITICAL --ignore-unfixed \
    --exit-code 1 --ignorefile /.trivyignore "$img:latest"
done
```

If `docker compose build` can't find `CHANGELOG.md` (or `init-db/`, or
`scripts/`), set `REPO_CONTEXT="$(pwd)"` — the `repo` additional build context
needs an absolute path on some Compose/buildx versions.

### What needs a rebuild

Since [Issue #224](https://github.com/aellington89/finance-stack/issues/224)
every service runs this repo's code from an **image**, not a bind mount, so a
plain `docker compose up` will happily keep running the code the image was built
with. Editing any of these means rebuilding before the change takes effect:

| Edited | Rebuild |
| --- | --- |
| `app/**` | `docker compose build finance-app` |
| `init-db/roles/*.sql`, `init-db/seeds/*.sql`, `app/scripts/*.sh`, `scripts/verify-db-roles.sh` | `docker compose build migrate` |
| `importer/poll.py`, `importer/requirements.txt` | `docker compose build importer` |
| `scripts/backup.sh`, `scripts/restore.sh`, `scripts/update-account-balance-history.sql` | `docker compose build pg-backup` |

`scripts/build.sh` with no arguments builds all four, which is the safe default.
The failure mode worth knowing is the quiet one: a stale `finance-migrate` image
applies the seed and role SQL it was *built* with and reports success, so a seed
edit appears to have been applied when it has not.

Still bind-mounted, and therefore still live: `imports/`, `backups/` and
`importer/parsers/`. `postgres` has no mount but its data volume — database
creation moved into the `migrate` job under
[#225](https://github.com/aellington89/finance-stack/issues/225), so it needs a
`docker compose build migrate` like everything else in that table.

### Lint and tests

After the gates pass, CI runs:

```sh
npm run lint
npm run test:coverage      # both projects; requires the Finances_Test database
```

`test:coverage` rather than `test:unit` + `test:integration`: since Issue #142
the suite runs once, merged, and **fails if coverage drops below the thresholds
in `app/vitest.config.ts`**. Running the halves separately would check the
thresholds against the wrong denominator — `lib/queries` and `lib/actions` are
most of it and are covered by the integration project, not the unit one.

See [docs/testing.md](docs/testing.md) for the unit/integration split and how
to point integration tests at the right database, and
[docs/testing.md#coverage](docs/testing.md#coverage) for the thresholds, what
the denominator includes, and how to raise them.

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
| `docker` | base images in `app/Dockerfile`, `importer/Dockerfile`, `scripts/Dockerfile` (one entry per directory) |
| `docker-compose` | service images in `docker-compose.yml` (`postgres`, `metabase`) |
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
`backup-smoke.yml` — Dependabot does not read workflow service containers — and
of `scripts/Dockerfile`, which it *does* read, but as a separate ecosystem, so it
arrives as its own PR rather than grouped with the compose bump. Merge them
together: `pg_dump` refuses to dump a server newer than itself, so a
`finance-backup` image left a major behind stops producing backups.

Since [#226](https://github.com/aellington89/finance-stack/issues/226) a `docker`
base bump changes a **published** artifact rather than only a local one, and all
four images are gated by their own Trivy scan — so these PRs are both the usual
way a base-image CVE gets cleared and the thing that has to be green before the
next tag ships that base to a deployment host.

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

**If your PR ships a migration**, also set or escalate the `**Migration:**` marker
on `## [Unreleased]` — `none` → `backward-compatible` → `breaking`, and never
downgrade it. The marker describes the release as a whole, not the last PR to
touch it, so a `breaking` already declared by an earlier PR stays `breaking`.
`[Unreleased]` may carry no marker at all until something needs one, but once it
does the value must be one of the three or the gate fails.

## Schema changes

Edit `app/drizzle/schema.ts`, generate a migration, and commit both in one PR, and
set or escalate the `**Migration:**` marker on `## [Unreleased]` to cover it. The
full procedure — including FK changes in `relations.ts`, reviewing generated SQL,
and adopting migrations on an existing database — is in
[docs/schema-changes.md](docs/schema-changes.md).

## Releases

Releasing closes the `CHANGELOG.md` section, bumps the version, and pushes an
annotated `vX.Y.Z` git tag. **Pushing that tag is the release** — it fires
[`.github/workflows/release.yml`](.github/workflows/release.yml), which runs the
version/tag-consistency gate, builds all four stamped images, boots the full
stack and verifies it, **then** pushes the images to GHCR and publishes the
GitHub Release.

**The ordering is the feature** ([#226](https://github.com/aellington89/finance-stack/issues/226)):
build → boot → verify → push. The login and push steps carry no `if:`, so a
failed verification skips them — an image that fails its own smoke test never
reaches the registry. Each tag publishes four packages, at `:X.Y.Z` and at the
full 40-char commit SHA:

```
ghcr.io/aellington89/finance-app        ghcr.io/aellington89/finance-importer
ghcr.io/aellington89/finance-migrate    ghcr.io/aellington89/finance-backup
```

The `:<sha>` tag is the same value `/api/health` reports as `build.gitSha`, so a
running container traces back to the health response that cleared it. The
packages are public — pulls on a deployment host need no authentication. Full
detail, including the one-time visibility step on first publish, is in
[docs/releases.md](docs/releases.md#published-images).

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
   `## [Unreleased]` above it. Update the reference links at the bottom. Make sure
   the closed section declares its `**Migration:** none | backward-compatible |
   breaking` marker directly under the heading — the changelog gate requires it.

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
