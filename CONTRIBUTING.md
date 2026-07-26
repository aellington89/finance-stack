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
- **`test`** is a staging branch for validation before merges to `master`.
- Work in a feature branch, open a PR against `master`, and let CI run. All
  gates must be green before merging (see [CI gates](#ci-gates) below).

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

Fails if any entry in `app/lib/constants/reference-ids.ts` (`SEED_REFERENCES`
table/id/name tuples) doesn't match a row in `init-db/seeds/shared-lookups.sql`.

**Fix:** run locally, then keep the two files in sync:

```sh
cd app && npm run check:seed-references
```

### Role privilege gate

Fails if the database service roles don't hold exactly the privileges
`init-db/roles/02-grants.sql` is meant to establish — too few or too many. Most
often tripped by a migration that adds a table or view the narrow
`finance_importer` / `finance_metabase` roles need, since those grants are
enumerated by hand (`finance_app` is covered automatically).

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

### Dependency audit gate

Fails if any **runtime** dependency carries a HIGH or CRITICAL advisory.

**Fix:** run locally, then bump whatever it names:

```sh
cd app && npm audit --omit=dev --audit-level=high
```

`npm audit fix` handles most cases. If the only fix is a major bump, or the
advisory is in a package vendored by a dependency (as with next's bundled
`postcss` and `sharp`), add an entry to `overrides` in `app/package.json` and
explain it in the `//overrides` note alongside it.

A second, **non-blocking** audit covers build-time dependencies. It is advisory
only because the eslint 9 toolchain currently has HIGH advisories whose sole fix
is eslint 10, which `eslint-config-next` does not yet support. Once that lands
upstream, make it blocking.

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
2. **Rebuild on a patched base image** (bump `node:22-alpine` in
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

Releasing creates an annotated `vX.Y.Z` git tag, closes the `CHANGELOG.md`
section, and publishes a GitHub Release manually. **There is no automated
Docker publish or registry push** — CI on a tag push only validates the gates,
lint, and tests.

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

3. **Bump the version.** Set `"version": "X.Y.Z"` in `app/package.json`.

4. **Commit.** E.g. `git commit -m "Release vX.Y.Z"`.

5. **Tag and push** (annotated):

   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z — <one-line summary>"
   git push origin vX.Y.Z
   ```

   CI validates the changelog gate and all other checks. If they pass, cut the
   GitHub Release manually from the `CHANGELOG.md` section.

See [docs/releases.md](docs/releases.md) for the complete procedure, tagging
rules (`vX.Y.Z` — annotated, `v` prefix, no stray dots), and the `awk` snippet
for slicing the release body out of `CHANGELOG.md`.
