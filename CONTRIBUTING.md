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

CI runs on every push to `master`/`test` and on all PRs. There are three gates
that can fail a build before lint and tests even run; all three are fast to
satisfy locally:

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

### Lint and tests

After the gates pass, CI runs:

```sh
npm run lint
npm run test:unit
npm run test:integration   # requires the Finances_Test database
```

See [docs/testing.md](docs/testing.md) for the unit/integration split and how
to point integration tests at the right database.

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
