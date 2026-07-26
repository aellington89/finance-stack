# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Required new configuration.** `FINANCE_APP_DB_PASSWORD`, `FINANCE_IMPORTER_DB_PASSWORD`, and `FINANCE_METABASE_DB_PASSWORD` must be added to `.env` (see `.env.example`) — the `migrate` service aborts with a pointer to `.env.example` rather than creating a login role with a blank password. Copy the three keys in and run `docker compose up`; the roles and grants are applied to existing databases automatically. Metabase users must additionally re-point the Finances connection at `finance_metabase` once in the admin UI, since Metabase stores analytics connections in its own metadata database rather than in environment variables ([Issue #130](https://github.com/aellington89/finance-stack/issues/130)).
- Node 22 → 24 (Krypton, Active LTS) across the whole toolchain: all four `app/Dockerfile` stages, the `node-version:` pin in the `ci`, `release` and `backup-smoke` workflows, and `@types/node` (which had drifted to `^20`, a major behind even the old 22 runtime). Node 22 left Active LTS in October 2025 and is supported in maintenance only until April 2027. Dependabot proposed jumping straight to 26, but 26 does not reach LTS until 2026-10-28 and nothing here needs it — `next` and `sharp` both declare `node >=20.9.0` — so 24 (EOL 2028-04-30) is the version this ships on until late October, tracked in [Issue #211](https://github.com/aellington89/finance-stack/issues/211). Moving the image and the test toolchain in one change is the point: Dependabot's `docker` ecosystem only reads Dockerfiles, so taking its PR alone would have left CI testing on 22 while the image shipped a different major ([Issue #210](https://github.com/aellington89/finance-stack/issues/210)).
- `lucide-react` 0.577 → 1.27. Lucide v1 removes every brand icon, drops the UMD build (ESM/CJS only, ~32% smaller), and now sets `aria-hidden="true"` on icons by default. None of this bites here: no brand icons are imported, all 33 icon names in use are still exported under the same names in 1.27.0, and every icon-only control already carries its own `aria-label` or `sr-only` label — so the new accessibility default is an improvement rather than a regression ([PR #206](https://github.com/aellington89/finance-stack/pull/206)).

### Added

- CI dependency and image gates: a blocking `npm audit --omit=dev --audit-level=high` on runtime dependencies (build-time dependencies are reported but non-blocking while the eslint 9 toolchain waits on `eslint-config-next` to support eslint 10), and a new parallel `image` job that builds the production image on **every PR** — previously it was only built on a `v*` tag, so a broken Dockerfile could reach `master` undetected — then scans it with Trivy, failing on fixable HIGH/CRITICAL findings. Documented exceptions go in the new `.trivyignore`, which requires a CVE, a rationale, and an expiry date per entry. CI's Postgres service image is pinned to `18.0` to match `docker-compose.yml` instead of floating on `18` ([Issue #131](https://github.com/aellington89/finance-stack/issues/131)).
- Dependabot (`.github/dependabot.yml`) watching five ecosystems weekly — npm (`app/`), pip (`importer/`), Docker (`app/Dockerfile`), Docker Compose (`docker-compose.yml`), and GitHub Actions — with npm updates grouped into dev and production sets so a routine week is two reviewable PRs rather than a dozen. Majors stay ungrouped. Auto-merge is deliberately not configured. To give the pip ecosystem a manifest to track, importer dependencies are now pinned in the new `importer/requirements.txt` and installed from it, replacing a Compose entrypoint that ran `pip install psycopg2-binary` unpinned on every container start ([Issue #131](https://github.com/aellington89/finance-stack/issues/131)).

- Scheduled database backups: a default-on `pg-backup` Compose service runs `pg_dump` (custom format) of the `Finances` and `metabase` databases into `./backups/` on an interval (default daily) with retention pruning, plus `scripts/backup.sh` / `scripts/restore.sh` (one-command restore into a clean DB, guarded against clobbering production DBs without `--force`) and a weekly `backup-smoke` CI workflow that seeds a known dataset, dumps it, restores it, and asserts a known row count to catch silent backup corruption. Documented in the new [docs/backups.md](docs/backups.md); tunable via `BACKUP_DBS` / `BACKUP_RETENTION_DAYS` / `BACKUP_INTERVAL_SECONDS` (see `.env.example`) ([Issue #122](https://github.com/aellington89/finance-stack/issues/122)).
- Session-based authentication (Auth.js/NextAuth v5, Credentials provider, JWT sessions): a sign-in page at `/login`, a sign-out control in the sidebar footer, a `users` table (authored migration `0003_add_users_table`) storing scrypt password hashes, and a first-user/password-reset CLI (`npm run auth:create-user -- <username>`). Requires a new `AUTH_SECRET` env var (see `.env.example` / `app/.env.local.example`) — documented in the new [docs/auth.md](docs/auth.md) ([Issue #120](https://github.com/aellington89/finance-stack/issues/120)).

### Security

- Patched two **critical** and eleven **high** advisories in runtime dependencies, taking `npm audit --omit=dev` from 19 findings to zero. The critical pair was in the auth stack shipped last cycle: `next-auth` 5.0.0-beta.31 / `@auth/core` could **fail open** — a configuration error populated the auth object rather than rejecting the request — and did not bind OAuth `state`/`nonce`/PKCE cookies to the provider that issued them (fixed by 5.0.0-beta.32). Also patched **SQL injection via improperly escaped SQL identifiers** in `drizzle-orm` <0.45.2, and HTTP request smuggling in `next` rewrites (16.1.6 → 16.2.12). Next vendors `postcss` 8.4.31 (path traversal / arbitrary file read) and `sharp` 0.34.5 (four libvips CVEs) with no fixed Next release available, so both are lifted via `overrides` in `app/package.json`. The `shadcn` CLI moved from `dependencies` to `devDependencies`, where it belonged — it is a scaffolding tool, imported by nothing at runtime ([Issue #131](https://github.com/aellington89/finance-stack/issues/131)).
- The production image no longer ships a package manager. The runner stage deletes `npm`, `npx`, `yarn` and `corepack` — the Next.js standalone server runs `node server.js` and never resolves or installs a package at runtime, so they were pure attack surface, handing anyone who gained execution in the container a way to fetch and run more code. They also carried their own vendored dependencies: npm's bundled `tar`, `sigstore`, `brace-expansion` and `picomatch` accounted for 1 CRITICAL and 5 HIGH findings in the new image scan — every finding it reported — none of which any application-level dependency bump could have cleared. The `migrate` stage keeps npm, since it runs `npx drizzle-kit` ([Issue #131](https://github.com/aellington89/finance-stack/issues/131)).
- All GitHub Actions across the three workflows are now pinned to full commit SHAs rather than mutable tags, with the version recorded in a trailing comment that Dependabot maintains. This is a direct response to the March 2026 compromise in which an attacker force-pushed credential-stealing malware over `aquasecurity/trivy-action`'s existing version tags — the same action this repo's new image scan depends on ([Issue #131](https://github.com/aellington89/finance-stack/issues/131)).

- Postgres surface-area lockdown: the Postgres (`5433`) and Metabase (`3000`) host ports are now bound to `127.0.0.1` instead of `0.0.0.0`, and the three long-running services no longer connect as the `postgres` superuser. Each authenticates as its own least-privilege role — `finance_app` (full DML on the core tables, **`SELECT`-only on `users`**, no DDL), `finance_importer` (append-only on `transactions` plus lookup reads, no `UPDATE`/`DELETE`), and `finance_metabase` (`SELECT` on the three views, no base-table access at all). None can create, alter, drop, or truncate a table, create roles or databases, or reach the `drizzle` migration ledger; tables stay owned by `POSTGRES_USER`. The superuser is retained only for the maintenance jobs that need DDL or cluster-wide reads (`migrate`, `init-script`, `pg-backup`). Roles and grants are created and re-applied idempotently by the `migrate` service on every `docker compose up` (`init-db/roles/`), so existing volumes are upgraded with no manual SQL, and the grant files revoke before granting so a hand-widened privilege converges back. A new CI "role privilege gate" (`scripts/verify-db-roles.sh`) asserts the full matrix against the catalog and then connects as each role to confirm permitted statements succeed and forbidden ones are refused. Documented in [docs/database.md](docs/database.md#roles--privileges) ([Issue #130](https://github.com/aellington89/finance-stack/issues/130)).
- All application pages and every server action now reject unauthenticated requests, enforced in three layers: the Next 16 proxy (`app/proxy.ts`) redirects to `/login`, the `(app)` layout re-verifies the session server-side, and `requireActionUser()` gates each of the 18 server actions individually. Only the landing page, `/login`, `/api/auth/*`, and `/api/health` (Docker healthcheck + release smoke test) remain public ([Issue #120](https://github.com/aellington89/finance-stack/issues/120)).

## [0.1.5] - 2026-07-10

### Added

- Database `CHECK` constraints (`transactions_transaction_description_not_blank`, `accounts_account_name_not_blank`) rejecting empty-string `transaction_description` / `account_name` — closing the gap where `NOT NULL` still permitted `''` that the app's `min(1)` validators reject. The `0002` migration backfills any pre-existing empty rows to a sentinel before enforcing the constraint. The columns and their FKs were already `NOT NULL`/constrained, so this empty-string tightening is the substantive change ([Issue #147](https://github.com/aellington89/finance-stack/issues/147)).

## [0.1.4] - 2026-07-05

### Added

- GitHub issue templates (feature + bug YAML forms) and a pull-request template whose checklist reinforces the `Issue #N -` commit convention, the `CHANGELOG.md` `[Unreleased]` habit, and the CI gates ([Issue #176](https://github.com/aellington89/finance-stack/issues/176)).
- Release workflow (`.github/workflows/release.yml`): pushing a `vX.Y.Z` annotated tag runs the version/tag-consistency gate, builds the stamped Docker image (`finance-app:X.Y.Z` + `:<sha>`), verifies `/api/health` reports the correct version + SHA, and publishes a GitHub Release whose body is the corresponding `CHANGELOG.md` section — automating the manual procedure steps from `docs/releases.md` ([Issue #175](https://github.com/aellington89/finance-stack/issues/175)).
- `CONTRIBUTING.md` codifying the dev workflow, commit convention (`Issue #N -`), CI gates (schema-drift, seed-reference, changelog), changelog entry habit, schema-change process, and release sequence (generator → CHANGELOG close → tag → publish) ([Issue #174](https://github.com/aellington89/finance-stack/issues/174)).
- Issue-`#N`-aware release-notes generator (`npm run release:notes`): reads a commit range, fetches GitHub issue labels, and prints a draft Keep-a-Changelog block (`--changelog`) or a GitHub Release body (`--release`) — with issue-linked bullets grouped into `Added`/`Changed`/`Fixed` and a suggested semver bump — to stdout, editing no files ([Issue #170](https://github.com/aellington89/finance-stack/issues/170)).
- "What's New" release-history page at `/settings/about`: parses `CHANGELOG.md` at request time and renders every release newest-first with live `Issue #N` links, `Added`/`Changed`/`Fixed` sections, and the current version highlighted. The sidebar footer version badge now links to the page, and an "About" nav item was added to the sidebar ([Issue #172](https://github.com/aellington89/finance-stack/issues/172)).
- Sidebar footer version badge (`components/version-badge.tsx`): renders `v<version>` (with a `(dev)` marker when the build is unstamped) plus a hover tooltip showing the version, short git SHA, and build time from `BUILD_INFO` ([Issue #171](https://github.com/aellington89/finance-stack/issues/171)).
- Build-time version + build-metadata surfacing: a single `lib/version.ts` `BUILD_INFO` constant (version inlined from `package.json`; git SHA and build time fed by `NEXT_PUBLIC_*` Docker build ARGs) consumed by both the client badge and `/api/health`, so the running image's version and commit are always visible ([Issue #165](https://github.com/aellington89/finance-stack/issues/165)).
- Migrated operational reference content (database, schema changes, testing, importer, project structure) from the root README into focused guides under `docs/`; slimmed the root README to a ≤ 120-line entry point with links to each guide ([Issue #168](https://github.com/aellington89/finance-stack/issues/168)).
- CI "changelog gate" (`npm run check:changelog`) asserting `package.json`'s version matches the newest `CHANGELOG.md` release and — on a tag push — that the tag is a well-formed `vX.Y.Z` equal to `v<version>`, catching version/changelog/tag drift at build time ([Issue #173](https://github.com/aellington89/finance-stack/issues/173)).
- CI "seed reference gate" (`npm run check:seed-references`) that verifies the `SEED_REFERENCES` names in code match the `INSERT` rows in `init-db/seeds/shared-lookups.sql`, catching code-side seed drift at build time ([Issue #155](https://github.com/aellington89/finance-stack/issues/155)).
- Database indexes: a partial index on `transactions(related_account_id)` and `account_balance_history(account_id, balance_date DESC)` ([Issue #127](https://github.com/aellington89/finance-stack/issues/127)).

### Changed

- Extracted `amountColorClass` and shared SQL aggregation helpers (`sumAmountByType()` / `balanceAtDate()` in `lib/queries/_aggregates.ts`), removing duplicated color logic and copy-pasted `SUM(CASE WHEN …)` blocks across the query layer ([Issue #134](https://github.com/aellington89/finance-stack/issues/134)).
- Centralized hardcoded reference-data IDs into `lib/constants/reference-ids.ts`, and turned `/api/health` into a per-request seed-drift check that returns `503` with a `drift[]` list when a seed row is missing or renamed ([Issue #123](https://github.com/aellington89/finance-stack/issues/123)).
- Adopted a real Drizzle migration system: `app/drizzle/schema.ts` is now the single source of truth, with a `0000_baseline` migration and a `migrate` Compose service replacing the hand-maintained `init-db/schema.sql` ([Issue #121](https://github.com/aellington89/finance-stack/issues/121)).
- Normalized the `0.1.3` git tag from the malformed lightweight `v.0.1.3` to an annotated `v0.1.3` on the same commit, deleted the malformed tag on origin, and rebuilt the `v0.1.0`–`v0.1.3` GitHub Releases baseline from this changelog. `vX.Y.Z` is now the only legal tag shape — see [Releases & Tagging](docs/releases.md) ([Issue #167](https://github.com/aellington89/finance-stack/issues/167)).

### Fixed

- Centralized date-range validation in `lib/validations/date-range.ts`; malformed `dateFrom`/`dateTo` params now render an inline error instead of silently swapping an out-of-order range or surfacing a raw Postgres 500 ([Issue #150](https://github.com/aellington89/finance-stack/issues/150)).
- The baseline migration no longer re-applies on databases that adopted the existing schema, unblocking new migrations on the real `Finances` and `Finances_Test` databases ([Issue #157](https://github.com/aellington89/finance-stack/issues/157)).

## [0.1.3] - 2026-05-17

### Added

- Liabilities drill-down page at `/dashboard/liabilities`: KPI strip, allocation treemap, category decomposition, debt waterfall, debt-service summary, and a 3-level performance table ([Issue #112](https://github.com/aellington89/finance-stack/issues/112)).
- Quick Select macros for the Date Range Picker — built-in rolling presets plus saveable, `localStorage`-persisted named ranges ([Issue #61](https://github.com/aellington89/finance-stack/issues/61)).
- Config-driven drill-down sub-tabs for every dashboard section, with the 11 new drill-down routes scaffolded as stubs.

### Changed

- Standardized the dashboard layout so every page shares one `DashboardPageHeader` contract (optional sub-nav, page title, filter bar), with titles normalized to short names.
- Moved Transactions column-visibility persistence from `localStorage` to a `txn-visible-columns` cookie, read server-side to eliminate the column flash on reload ([Issue #106](https://github.com/aellington89/finance-stack/issues/106)).
- Made `SORTABLE_COLUMNS` the single source of truth for the sortable-column whitelist, removing the duplicated page-level list ([Issue #107](https://github.com/aellington89/finance-stack/issues/107)).

### Fixed

- Date Range filter UX: draft-and-commit Apply flow, plain-text `YYYY-MM-DD` inputs, and explicit Apply/Clear buttons ([Issue #61](https://github.com/aellington89/finance-stack/issues/61)).
- Transactions table now uses fixed column widths so sort-button positions stay put across sorts, pagination, and filtering.

## [0.1.2] - 2026-05-01

### Added

- Assets drill-down page at `/dashboard/assets` plus per-type/per-account liquidity classification ([Issue #102](https://github.com/aellington89/finance-stack/issues/102)).
- Inline row edit and single-row delete on the Transactions table, with atomic balance-history rebuilds ([Issue #99](https://github.com/aellington89/finance-stack/issues/99)).
- Related Account column on the Transactions table ([Issue #105](https://github.com/aellington89/finance-stack/issues/105)).

### Changed

- Made the Net Worth KPI and historical-trends chart obviously clickable with a visible hover affordance and a chevron ([Issue #97](https://github.com/aellington89/finance-stack/issues/97)).

## [0.1.1] - 2026-04-16

### Added

- Importer Docker service that polls `imports/` subfolders for file ingestion, routing each subfolder to a parser module ([Issue #84](https://github.com/aellington89/finance-stack/issues/84)).
- Synced shared lookup tables across `Finances`/`Finances_Test` and auto-seeded `Finances_Test` mock data (424 deterministic transactions) on first launch ([PR #88](https://github.com/aellington89/finance-stack/pull/88)).
- Net Worth drill-down page at `/dashboard/net-worth` (waterfall analysis, drivers table, trend decomposition) with the `SummaryDrilldownTabs` sub-nav.
- Error boundary, the Vitest unit/integration test suite, a GitHub Actions CI workflow, and `/test-ui` gated to development-only ([Issue #79](https://github.com/aellington89/finance-stack/issues/79)).

### Changed

- Persist Date, Account, and Transaction Type on transaction-form submit so users can enter runs of related transactions ([Issue #67](https://github.com/aellington89/finance-stack/issues/67)).
- Net Worth drill-down: 3-level expandable drivers hierarchy (category → type → account) and a "By Account Type" decomposition mode.

### Fixed

- Past-dated transactions no longer break net-worth balances; `ensureTodayBalances()` now fills all missing gap dates instead of only today ([Issue #95](https://github.com/aellington89/finance-stack/issues/95)).
- Dashboard incorrect-balances fix via an `ensureTodayBalances()` carry-forward run on dashboard load ([Issue #68](https://github.com/aellington89/finance-stack/issues/68)).
- Aligned the integration-test database with production lookup values by idempotently upserting the full `account_type_categories` and `transaction_types` row sets ([Issue #87](https://github.com/aellington89/finance-stack/issues/87)).

### Security

- Fixed a SQL-injection vulnerability in `accounting.ts` and `work-expenses.ts` by parameterizing all user-controlled filter values, and blocked self-referential transactions ([Issue #79](https://github.com/aellington89/finance-stack/issues/79)).

## [0.1.0] - 2026-03-29

### Added

- Unified, persistent sidebar navigation (shadcn Sidebar) connecting all application sections, with a Next.js route-group split for the landing page vs. the app shell ([Issue #77](https://github.com/aellington89/finance-stack/issues/77)).

---

Earlier alpha history (v0.1.0-alpha.1 – v0.1.0-alpha.5) is recorded in the
[Alpha Development History](https://github.com/aellington89/finance-stack/wiki/Alpha-Development-History)
wiki page.

[Unreleased]: https://github.com/aellington89/finance-stack/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/aellington89/finance-stack/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/aellington89/finance-stack/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/aellington89/finance-stack/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/aellington89/finance-stack/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aellington89/finance-stack/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aellington89/finance-stack/releases/tag/v0.1.0
