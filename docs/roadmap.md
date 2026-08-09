# Versioning Roadmap

How Finance Stack's milestones map to release versions on the path to **v1.0.0**
and beyond. For the mechanics of *cutting* a release (tags, changelog, workflow),
see [Releases & Tagging](releases.md).

## How versions relate to issues and milestones

Two rules govern everything below:

- **An issue landing does not change the version.** Merging an issue adds a commit
  to `master` and a bullet under `## [Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md).
  Until a release is cut, the build still reports the last released version with a
  `(dev)` marker and the current git SHA (via `BUILD_INFO` / `/api/health`).
  Example: when [#147](https://github.com/aellington89/finance-stack/issues/147)
  lands but [#149](https://github.com/aellington89/finance-stack/issues/149) has
  not, the app is **still `v0.1.4`** (`0.1.4 (dev)` at a `master` SHA), with #147
  sitting in `[Unreleased]`.
- **A milestone completing is what triggers cutting a release.** The version number
  is chosen at tag time from everything accumulated since the last tag — breaking →
  major, new feature → minor, fixes/chores → patch.

So **milestones map to versions; issues map to changelog entries.** The mapping in
this document is a *plan*, not a constraint: you can slice a release wherever
`[Unreleased]` is worth shipping. If you ever want one issue out ahead of its
milestone, cut the release with just that issue and move the rest to the next
milestone.

## What v1.0.0 means here

This is a **personal-finance data store**, and until v0.2.0 it had no
authentication at all — anyone who could reach the port could read and delete
every record. Phase 1 closed that, and the remaining gap is the one the
[README](../README.md) still warns about: the app speaks plain HTTP, so the
default posture is a trusted network. For an app like this, `1.0.0` is a
**safety and stability commitment** ("log in, don't lose your data, expose it
safely"), *not* a feature-completeness claim. Budgets, forecasting, search,
receipts, and the rest are additive — textbook `1.x` minor releases.

**v1.0.0 is cut once Phases 0–2 have shipped and stabilized in real use**, which
includes closing out the remaining security-epic
([#100](https://github.com/aellington89/finance-stack/issues/100)) scope. It is a
commitment made *after* the risky auth work has proven stable, not the moment it
merges.

## The roadmap

| Version | Milestone | Theme | Bump |
|---|---|---|---|
| **v0.1.5** ✅ | Phase 0 — Quick wins + the migration refactor | Finish the 0.1.x tech-debt cleanup — **released 2026-07-10** | Patch |
| **v0.2.0** ✅ | Phase 1 — Pre-exposure gates | Auth + hardening + backup + observability + security close-out. First build safe beyond localhost — **released 2026-08-09** | Minor |
| **v0.3.0** | Phase 2 — Auth-gated lookup-table protection | Roles/admin, seed-data integrity. **This is the 1.0 release candidate** | Minor |
| **v1.0.0** | *(stabilization of 0.2.0–0.3.0)* | **The safety/stability commitment: trustworthy & exposable** | **Major** |
| **v1.1.0** | Phase 3 — DX compounding | Importer hardening, E2E tests, tooling | Minor |
| **v1.2.0** | Phase 4 — Performance polish | Caching, materialized views, chart consolidation | Minor |
| **v1.3.0** | Phase 5 — Small UX fixes | Accessibility, mobile, UX debt | Minor |
| **v1.4.0 →** | Phase 6 — Features | One minor release per feature | Minor (each) |

> **Judgment call.** An *aggressive* 1.0 could fire the moment Phase 1 ships (auth =
> 1.0). This roadmap takes the conservative path: 1.0 is a promise best made after
> auth has shaken out across a 0.2/0.3 line. Testing gates
> [#141](https://github.com/aellington89/finance-stack/issues/141) and
> [#142](https://github.com/aellington89/finance-stack/issues/142) (nominally
> Phase 3 / v1.1.0) are **recommended before cutting v1.0.0** for release
> confidence.

## Per-issue mapping

### v0.1.5 — Phase 0
**✅ Released 2026-07-10** — see [CHANGELOG](../CHANGELOG.md#015---2026-07-10).

### v0.2.0 — Phase 1 (Pre-exposure gates)
**✅ Released 2026-08-09** — see [CHANGELOG](../CHANGELOG.md#020---2026-08-09).
The milestone shipped whole rather than sliced; all 23 issues below are in it.

- [#120](https://github.com/aellington89/finance-stack/issues/120) Authentication & authorization
- [#130](https://github.com/aellington89/finance-stack/issues/130) Lock down Postgres surface area
- [#122](https://github.com/aellington89/finance-stack/issues/122) Backup & disaster recovery
- [#129](https://github.com/aellington89/finance-stack/issues/129) Observability: error tracking + structured logs
- [#131](https://github.com/aellington89/finance-stack/issues/131) CI hardening (audit, Dependabot, image scan, schema drift)
- [#100](https://github.com/aellington89/finance-stack/issues/100) Security & integrity model *(tracking epic — closes when its children do)*
- [#179](https://github.com/aellington89/finance-stack/issues/179) Input validation & error-message conventions audit *(new)*
- [#180](https://github.com/aellington89/finance-stack/issues/180) Audit logging for financial mutations *(new)*
- [#181](https://github.com/aellington89/finance-stack/issues/181) Secret management audit & production secret sourcing *(new)*
- [#239](https://github.com/aellington89/finance-stack/issues/239) `metabase_user` is a superuser; role attributes are never asserted or re-applied *(new — from #181)*
- [#182](https://github.com/aellington89/finance-stack/issues/182) Edge hardening: TLS, security headers, rate limiting *(new)*
- [#187](https://github.com/aellington89/finance-stack/issues/187) Backfill `transaction_types` id=12 — `/api/health` seed drift (503) *(new)*
- [#186](https://github.com/aellington89/finance-stack/issues/186) List all docs/ guides in the docs README Guides section *(new)*
- [#189](https://github.com/aellington89/finance-stack/issues/189) Make `POSTGRES_PASSWORD` and `MB_DB_PASS` rotatable from `.env` *(new)*
- [#191](https://github.com/aellington89/finance-stack/issues/191) Split `/api/health` into a liveness probe + seed-data check *(new)*
- [#194](https://github.com/aellington89/finance-stack/issues/194) Make the build-time `npm audit` gate blocking *(new — from #131)*
- [#249](https://github.com/aellington89/finance-stack/issues/249) Metabase's `Finances` connection is the `postgres` superuser; add a read-only BI role *(new — from #181)*
- [#250](https://github.com/aellington89/finance-stack/issues/250) Retire `finance_metabase`: two near-identical BI credentials for one job *(new — from #249)*
- [#210](https://github.com/aellington89/finance-stack/issues/210) Move the Node base image and CI toolchain to 24 (LTS) *(new — from #131)*
- [#213](https://github.com/aellington89/finance-stack/issues/213) Track Metabase on the LTS line: bump to v0.58.21 and ignore non-LTS bumps *(new — from #131)*
- [#215](https://github.com/aellington89/finance-stack/issues/215) Tighten the `typescript` devDependency floor *(new — from #131)*
- [#217](https://github.com/aellington89/finance-stack/issues/217) Remove the dead `table` classNames key from `calendar.tsx` (blocks react-day-picker v10) *(new — from #131)*
- [#219](https://github.com/aellington89/finance-stack/issues/219) Re-derive `chart.tsx` tooltip/legend props from the default content components (blocks recharts v3) *(new — from #131)*

> Phase 1 was large enough to have been sliced (e.g. auth core as v0.2.0, the
> heavier security items trailing into v0.2.x/v0.3.0), and was not — everything
> in the milestone went out together. The general rule still stands for the
> phases below: a milestone maps to a version *band*, and you cut when ready.

### v0.3.0 — Phase 2 (1.0 release candidate)
- [#81](https://github.com/aellington89/finance-stack/issues/81) Restrict settings/categories page to admin users
- [#87](https://github.com/aellington89/finance-stack/issues/87) Restrict user-level editing of static lookup tables
- [#109](https://github.com/aellington89/finance-stack/issues/109) Protect pinned transaction_categories rows
- [#178](https://github.com/aellington89/finance-stack/issues/178) Define the seed-data taxonomy

### v1.1.0 — Phase 3 (DX compounding)
- [#124](https://github.com/aellington89/finance-stack/issues/124) Importer idempotency + dead-letter handling
- [#132](https://github.com/aellington89/finance-stack/issues/132) Importer Dockerfile + healthcheck
- [#133](https://github.com/aellington89/finance-stack/issues/133) Pre-commit hooks + Makefile
- [#141](https://github.com/aellington89/finance-stack/issues/141) E2E tests with Playwright *(recommended before v1.0.0)*
- [#142](https://github.com/aellington89/finance-stack/issues/142) Coverage thresholds in vitest.config.ts *(recommended before v1.0.0)*
- [#185](https://github.com/aellington89/finance-stack/issues/185) Audit docker-compose services: necessity & profile gating *(new)*
- [#193](https://github.com/aellington89/finance-stack/issues/193) Adopt `react-hooks/set-state-in-effect`; drop the `eslint-plugin-react-hooks` pin *(new — from #131)*
- [#195](https://github.com/aellington89/finance-stack/issues/195) Run `npm run typecheck` in CI *(new — from #131)*
- [#263](https://github.com/aellington89/finance-stack/issues/263) Bump to eslint 10 once `eslint-config-next` ships plugins that support it *(new — split from #194; blocked upstream)*
- [#232](https://github.com/aellington89/finance-stack/issues/232) Wire an error-tracking backend into `reportError()` *(new — from #129)*
- [#237](https://github.com/aellington89/finance-stack/issues/237) Nonce-based CSP: remove `'unsafe-inline'` from `script-src` and `style-src` *(new — from #182)*

### v1.2.0 — Phase 4 (Performance polish)
- [#125](https://github.com/aellington89/finance-stack/issues/125) Suspense + loading.tsx + not-found.tsx
- [#126](https://github.com/aellington89/finance-stack/issues/126) Cache ensureTodayBalances() and dashboard queries
- [#128](https://github.com/aellington89/finance-stack/issues/128) Consolidate chart libraries onto Recharts
- [#143](https://github.com/aellington89/finance-stack/issues/143) Memoize hierarchy build + getAssetPerformance
- [#146](https://github.com/aellington89/finance-stack/issues/146) Materialized view for v_transactions_full

### v1.3.0 — Phase 5 (Small UX fixes)
- [#118](https://github.com/aellington89/finance-stack/issues/118) Evaluate cookie-based persistence for txn-visible-columns / sidebar_state
- [#144](https://github.com/aellington89/finance-stack/issues/144) Accessibility: keyboard nav, color+icon, chart SVG titles
- [#145](https://github.com/aellington89/finance-stack/issues/145) Mobile form layout
- [#148](https://github.com/aellington89/finance-stack/issues/148) Replace window.confirm() in transaction-list.tsx

### v1.4.0 onward — Phase 6 (Features, one minor each)
- [#136](https://github.com/aellington89/finance-stack/issues/136) Budgets + spending caps
- [#135](https://github.com/aellington89/finance-stack/issues/135) Recurring transactions / scheduled entries
- [#137](https://github.com/aellington89/finance-stack/issues/137) Transaction search + CSV export
- [#138](https://github.com/aellington89/finance-stack/issues/138) Forecasting + savings-rate KPIs
- [#139](https://github.com/aellington89/finance-stack/issues/139) Receipt attachments + transaction tagging
- [#140](https://github.com/aellington89/finance-stack/issues/140) Settings: theme, currency, profile
- [#110](https://github.com/aellington89/finance-stack/issues/110) Liabilities schema expansion
- [#111](https://github.com/aellington89/finance-stack/issues/111) User-defined liability categories

## Notes

- **DB integrity** (from #100) is covered by
  [#147](https://github.com/aellington89/finance-stack/issues/147) (NOT NULL) and
  [#130](https://github.com/aellington89/finance-stack/issues/130) (Postgres
  lockdown); no separate issue is tracked for it.
- **Pre-release tags.** The CI changelog gate currently accepts only stable
  `vX.Y.Z`. To ship a `v1.0.0-rc.1`, broaden the tag regex to accept
  `-rc.N` / `-beta.N` first (see [Releases & Tagging](releases.md)).
- **Cadence.** Historically every release was a `0.1.x` patch. Going forward, use
  one **minor** bump per phase (above) so the version number carries information;
  reserve patches for fixes within a phase.
