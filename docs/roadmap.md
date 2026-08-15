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
  Example: when [#81](https://github.com/aellington89/finance-stack/issues/81)
  lands but the rest of Phase 2 has not, the app is **still `v0.2.0`**
  (`0.2.0 (dev)` at a `master` SHA), with #81 sitting in `[Unreleased]`.
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

"Expose it safely" is why **Phase 2.5 is a 1.0 gate rather than tooling polish**.
Today the deploy root *is* the git checkout: `docker-compose.yml` builds from
`./app` and bind-mounts the scripts, so deploying means cloning the repo onto the
target and building there, and the image that runs is not the image CI verified
([#223](https://github.com/aellington89/finance-stack/issues/223)). A release
process that stops before producing a deployable artifact cannot make a promise
about how the thing behaves once deployed.

**v1.0.0 is cut once Phases 0–2.5 have shipped and stabilized in real use**,
which includes closing out the remaining security-epic
([#100](https://github.com/aellington89/finance-stack/issues/100)) scope. It is a
commitment made *after* the risky auth work has proven stable, not the moment it
merges.

## The roadmap

| Version | Milestone | Theme | Bump |
|---|---|---|---|
| **v0.1.5** ✅ | Phase 0 — Quick wins + the migration refactor | Finish the 0.1.x tech-debt cleanup — **released 2026-07-10** | Patch |
| **v0.2.0** ✅ | Phase 1 — Pre-exposure gates | Auth + hardening + backup + observability + security close-out. First build safe beyond localhost — **released 2026-08-09** | Minor |
| **v0.3.0** | Phase 2 — Auth-gated lookup-table protection | Roles/admin, seed-data integrity | Minor |
| **v0.4.0** | Phase 2.5 — Deployment & upgrade | GHCR images + deploy bundle: a verified artifact and a backup-gated, health-checked upgrade. **This is the 1.0 release candidate** | Minor |
| **v1.0.0** | *(stabilization of 0.2.0–0.4.0)* | **The safety/stability commitment: trustworthy & exposable** | **Major** |
| **v1.1.0** | Phase 3 — DX compounding | Importer hardening, E2E tests, tooling | Minor |
| **v1.2.0** | Phase 4 — Performance polish | Caching, materialized views, chart consolidation | Minor |
| **v1.3.0** | Phase 5 — Small UX fixes | Accessibility, mobile, UX debt | Minor |
| **v1.4.0 →** | Phase 6 — Features | One minor release per feature | Minor (each) |

> **Judgment call.** An *aggressive* 1.0 could fire the moment Phase 1 ships (auth =
> 1.0). This roadmap takes the conservative path: 1.0 is a promise best made after
> auth has shaken out across a 0.2/0.3/0.4 line. Testing gates
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

### v0.3.0 — Phase 2 (Auth-gated lookup-table protection)
- [#81](https://github.com/aellington89/finance-stack/issues/81) Restrict settings/categories page to admin users
- [#87](https://github.com/aellington89/finance-stack/issues/87) Restrict user-level editing of static lookup tables
- [#109](https://github.com/aellington89/finance-stack/issues/109) Protect the lookup rows the app owns; drop Transaction Type creation
- [#178](https://github.com/aellington89/finance-stack/issues/178) Define the seed-data taxonomy
- [#111](https://github.com/aellington89/finance-stack/issues/111) User-defined liability categories *(moved from Phase 6 by #178)*

> **#178 reshaped the rest of this milestone.** The taxonomy it defines classifies
> the ~15 `transaction_categories` rows the Liabilities drilldown pins as *user
> data that code hard-depends on* — the one combination the taxonomy calls a
> defect rather than a category. Shipping those rows was rejected (it would bake
> one loan portfolio into every install and still need a code change to extend),
> so the resolution is **#111**, which moves here from Phase 6: it is no longer an
> additive feature but the fix for a filed integrity defect.
>
> **#109 then shipped wider than that reading suggested.** Rather than a
> `protected` column it derives protection from the constants that already
> declare these rows, and rather than one row it locks all 19 that
> `shared-lookups.sql` ships, across all three lookup tables — plus the liability
> pins, matched on id *and* name so protection is self-limiting on an install
> that never had them. It also removed Transaction Type creation outright. That
> takes a large bite out of **#87**: `transaction_types` is now add-proof with its
> shipped rows locked, and `account_type_categories` has no UI to restrict. What
> is left of #87 is the role gate and the admin screen — which is also where a
> legitimate future `transaction_types` insert would live.
>
> **#111 then removed a piece of #109.** The liability pins are gone —
> `transaction_categories.reporting_role` carries what the ids used to mean, so
> those fifteen rows are ordinary user data again and the second protection rule
> went with them.

### v0.4.0 — Phase 2.5 (Deployment & upgrade — 1.0 release candidate)
- [#223](https://github.com/aellington89/finance-stack/issues/223) Deployment & upgrade mechanism: GHCR images + deploy bundle *(tracking epic — closes when its children do)*
- [#224](https://github.com/aellington89/finance-stack/issues/224) Containerize the importer and backup services; bake code out of bind mounts
- [#225](https://github.com/aellington89/finance-stack/issues/225) Fold database creation into the migrate service
- [#226](https://github.com/aellington89/finance-stack/issues/226) Publish versioned images to GHCR from `release.yml`
- [#227](https://github.com/aellington89/finance-stack/issues/227) Deployment bundle: production compose, systemd unit, release asset
- [#228](https://github.com/aellington89/finance-stack/issues/228) `deploy.sh`: pre-upgrade backup gate and health-gated rollback
- [#229](https://github.com/aellington89/finance-stack/issues/229) Deployment docs and the migration-reversibility marker

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
- [#260](https://github.com/aellington89/finance-stack/issues/260) `release.yml` uses `MB_DB_USER: metabase`, diverging from the shipped `metabase_user` *(new — from #250)*
- [#211](https://github.com/aellington89/finance-stack/issues/211) Re-take `node:26-alpine` once it reaches LTS *(after 2026-10-28; from #210)*
- [#221](https://github.com/aellington89/finance-stack/issues/221) CONTRIBUTING.md Trivy remediation still names `node:22-alpine` after the Node 24 move *(from #210)*
- [#222](https://github.com/aellington89/finance-stack/issues/222) `docker-compose.yml` header comment lists five services; there are seven
- [#269](https://github.com/aellington89/finance-stack/issues/269) `transaction_categories`' identity sequence is named `transaction_type_categories_…`; the guessable name matches nothing *(new — from #178)*
- [#271](https://github.com/aellington89/finance-stack/issues/271) `transaction_types` id 9 ships as `Accrued Amoritized Interest` — *amortized* is misspelled *(new — from #109)*
- [#273](https://github.com/aellington89/finance-stack/issues/273) `importer/parsers/paystubs.py` hardcodes 17 lookup ids; five categories and the pay account are absent from the test fixture *(new — from #109)*

> **#273 is importer hardening's real prerequisite.** #124 and #132 above treat
> the importer as a service to make idempotent and containerize; #273 is the data
> coupling underneath it — a second, undocumented instance of the defect cell in
> the [seed-data taxonomy](database.md#seed-data-taxonomy), left open when #109
> closed the first. Worth sequencing before #124, since resolving it changes what
> a retried import is keyed on.

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
- [#251](https://github.com/aellington89/finance-stack/issues/251) Debt Waterfall: axis scale dominated by total balance makes period changes unreadable

### v1.4.0 onward — Phase 6 (Features, one minor each)
- [#136](https://github.com/aellington89/finance-stack/issues/136) Budgets + spending caps
- [#135](https://github.com/aellington89/finance-stack/issues/135) Recurring transactions / scheduled entries
- [#137](https://github.com/aellington89/finance-stack/issues/137) Transaction search + CSV export
- [#241](https://github.com/aellington89/finance-stack/issues/241) Duplicate a transaction with field modifications
- [#274](https://github.com/aellington89/finance-stack/issues/274) Totals Over Time: plot the total of any transaction type (e.g. Refunds) *(new)*
- [#138](https://github.com/aellington89/finance-stack/issues/138) Forecasting + savings-rate KPIs
- [#139](https://github.com/aellington89/finance-stack/issues/139) Receipt attachments + transaction tagging
- [#140](https://github.com/aellington89/finance-stack/issues/140) Settings: theme, currency, profile
- [#110](https://github.com/aellington89/finance-stack/issues/110) Liabilities schema expansion

> **#274 is the smallest thing in this phase, and it has a sequencing tie.** It is
> a feature rather than UX debt — Income/Expenses/Investments are compiled into
> `getAccountingTimeSeries()` and the chart component alike, so making the series
> selectable widens the query's row shape, not just the legend — which is why it
> sits here rather than in Phase 5. But it is small enough to ride along with
> another minor if one is being cut anyway. It also lands in the same file as
> [#128](https://github.com/aellington89/finance-stack/issues/128) (Phase 4, chart
> consolidation); doing #128 first avoids reworking the series plumbing twice.

## Notes

- **Every open issue carries a milestone, and every milestone's issues are listed
  above.** This is the invariant that keeps the two views honest — GitHub is where
  work is filed, this file is where it maps to a version. An issue with no
  milestone is invisible to the release plan, which is how the deployment epic
  (#223) grew to seven issues before appearing here at all. When filing, assign
  the milestone and add the bullet in the same pass; to audit, compare
  `gh issue list --state open --json number,milestone` against the sections above.
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
