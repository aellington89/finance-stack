# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/aellington89/finance-stack/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/aellington89/finance-stack/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/aellington89/finance-stack/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/aellington89/finance-stack/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aellington89/finance-stack/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aellington89/finance-stack/releases/tag/v0.1.0
