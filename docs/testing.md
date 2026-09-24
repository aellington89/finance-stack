# Testing

Covers running unit, integration and end-to-end tests, the static lookup-table fixtures, and the database role gate.

## Database Role Gate

CI verifies the least-privilege service roles (Issue #130) on every PR via [`scripts/verify-db-roles.sh`](../scripts/verify-db-roles.sh): it applies the real grant files to `Finances_Test`, asserts the whole grant matrix against the catalog, and then connects as each role to confirm that permitted statements succeed and forbidden ones are refused with `SQLSTATE 42501`. Run it yourself with:

```bash
docker compose run --rm --entrypoint bash migrate /scripts/verify-db-roles.sh Finances
```

**The integration suite still connects as `postgres`, and should stay that way.** Two of its behaviours are ones `finance_app` is deliberately not allowed: [`vitest-setup.ts`](../app/tests/integration/vitest-setup.ts) calls `setval()` on the lookup sequences (needs `UPDATE` on the sequence; the role has only `USAGE`), and [`auth/verify-credentials.test.ts`](../app/tests/integration/auth/verify-credentials.test.ts) inserts into `users` (read-only to the app role). Pointing the suite at `finance_app` would fail for exactly the reasons the grants exist — role coverage belongs in the gate above, not in the suite.

## Static Lookup Tables in Integration Tests

The integration test `beforeAll` (in [`app/tests/integration/vitest-setup.ts`](../app/tests/integration/vitest-setup.ts)) upserts the full production row set for `account_type_categories` (6 rows), `transaction_types` (12 rows) and the `transaction_categories` rows tests depend on, before any test runs. This is a drift-correction safety net — the seed files already populate these tables on first launch. No manual seed step is required.

**That hook is a safety net, not a definition — and CI now enforces the difference (Issue #178).** A fixture row belongs in [`init-db/seeds/finances-test-mock-data.sql`](../init-db/seeds/finances-test-mock-data.sql), which is what the `migrate` service actually applies to `Finances_Test`. `npm run check:seed-references` asserts that every `transaction_categories` row the `beforeAll` upserts also exists in that seed with the same name, and that the seed tags at least one category with **every reporting role** the query layer can filter on.

The check is directional: the seed may hold rows the hook does not bother re-converging, but never the reverse. Adding a row *only* to `vitest-setup.ts` fails the gate — which is the point. Four liability categories (ids 7, 8, 75 and 76) were pinned by shipping queries and missing from the seed for four releases, and the suite passed anyway because this hook supplied them at startup; the tests were asserting debt totals over a short set without anyone noticing.

The role-coverage half is that same guarantee re-expressed after Issue #111 replaced the pinned IDs with `transaction_categories.reporting_role`. A role no fixture category carries is a role whose aggregate the suite cannot distinguish from zero, so a test asserting over it proves nothing — exactly the shape of the ids 7/8/75/76 gap. The hook re-converges the roles too, unconditionally rather than guarded on `IS NULL`, because a test that retags or clears a category must not leave the next file asserting over a changed set.

> **The `transaction_categories` `INSERT` blocks must stay `(<id>, '<name>')` tuples**, in both the fixture and the hook. The gate's parser reads nothing else, so a third column makes every row in the block stop matching and the checks pass over an empty set — silently. Roles are applied by separate `UPDATE` statements for that reason, and the gate now fails on a block it cannot read rather than trusting the convention to hold.

At runtime, [`/api/health/seed-data`](../app/app/api/health/seed-data/route.ts) performs the equivalent check live: it verifies every ID referenced from [`app/lib/constants/reference-ids.ts`](../app/lib/constants/reference-ids.ts) still resolves to its canonical seed-row name, and returns 503 with a `drift[]` array if any row is missing or renamed. It requires a session and answers 401 without one. Its sibling [`/api/health`](../app/app/api/health/route.ts) is liveness only — one `SELECT 1` plus the build stamp — and is the endpoint the Docker healthcheck and the release smoke test poll (Issue #191). See the Issue #123 changelog entry for the drift response shape.

The two are covered by [`tests/integration/api/health.test.ts`](../app/tests/integration/api/health.test.ts) and [`tests/integration/api/health-seed-data.test.ts`](../app/tests/integration/api/health-seed-data.test.ts), which share their row-restoring fixture via [`tests/integration/api/seed-rows.ts`](../app/tests/integration/api/seed-rows.ts) — a plain module, not a `*.test.ts`, so the project's include glob does not collect it twice. The liveness suite asserts the split holds in both directions: a drifted seed row must still return 200, and the endpoint must issue exactly one query.

## Running Tests

Tests use [Vitest](https://vitest.dev/) and are split into three projects,
divided by what each one *needs* rather than by what it covers — no DOM, a DOM,
a database:

| Project | Collects | Environment | Command | Requires DB? |
|---|---|---|---|---|
| Unit | `tests/unit/**/*.test.ts` | node | `npm run test:unit` | No |
| jsdom | `tests/unit/**/*.test.tsx` | jsdom | `npm run test:jsdom` | No |
| Integration | `tests/integration/**/*.test.ts` | node | `npm run test:integration` | Yes (`Finances_Test`) |

The unit and jsdom projects are split **by file extension, not by directory** —
both collect from `tests/unit/`. That is deliberate: the two globs are disjoint
by construction, so no file can be picked up by two projects, and a component
test lives next to the transform test for the same feature.

The [end-to-end suite](#end-to-end-tests) is Playwright rather than Vitest and
runs separately — `npm run test:e2e`.

> **CI runs Node 24; local development is typically on Node 22.** That matters
> for any assertion whose expected value comes from `Intl` rather than from our
> own code, because the two ship different ICU versions. `Intl.NumberFormat`
> with `notation: "compact"` is the one that has actually bitten: below the
> compaction threshold, ICU 78 (Node 22) renders `$12.0` and Node 24 renders
> `$12`, so an exact assertion there passes locally and fails in CI. Assert on
> what the function under test owns — the currency, the magnitude, the sign —
> and match loosely where ICU decides the rest. Above the threshold (`$1.2K`,
> `$1.5M`) the output is stable and can be asserted exactly.

**Unit tests** cover Zod validation schemas and pure utility functions. They run with no external dependencies.

**jsdom tests** mount React components and hooks with
[Testing Library](https://testing-library.com/docs/react-testing-library/intro/).
See [The jsdom project](#the-jsdom-project) for what the setup file stubs and
the one teardown rule that will bite you.

**Integration tests** run server actions against `Finances_Test`. Ensure `DATABASE_URL` in `app/.env.local` points to `Finances_Test` before running them. The integration test global setup will throw if it detects a non-test URL.

```bash
cd app

# Run all tests
npm test

# Run only unit tests (no DB needed)
npm run test:unit

# Run only component/hook tests (no DB needed)
npm run test:jsdom

# Run only integration tests (requires Finances_Test DB)
npm run test:integration

# Generate coverage report
npm run test:coverage
```

### The jsdom project

Added by Issue [#296](https://github.com/aellington89/finance-stack/issues/296).
Four devDependencies (`jsdom`, `@testing-library/react`,
`@testing-library/jest-dom`, `@testing-library/user-event`) and no React plugin
— `app/tsconfig.json` sets `"jsx": "react-jsx"`, so Vite's esbuild transforms
`.tsx` on its own and `@vitejs/plugin-react` would only add Fast Refresh, which
tests do not use.

[`app/tests/jsdom/vitest-setup.ts`](../app/tests/jsdom/vitest-setup.ts) does four
things, and three of them are there because a render throws without them:

| | Why |
|---|---|
| `afterEach(cleanup)` | **The one to know about.** Testing Library registers its own cleanup through the global `afterEach`, but *only* under `globals: true` — and this suite imports `describe`/`it`/`expect` from `"vitest"` instead. Without the explicit call the previous test's tree stays mounted, and the *second* render of a component in any one file starts failing with "found multiple elements". That reads as a bad selector, not a missing teardown. If a test passes alone and fails in a file, start here. |
| `window.matchMedia` stub | jsdom does not implement it, and [`hooks/use-mobile.ts`](../app/hooks/use-mobile.ts) calls it on mount — as does anything reaching it through `useSidebar`. |
| `ResizeObserver` stub | Same, for the `@base-ui/react` primitives. |
| `vi.mock("next/navigation")` | The Next.js runtime the suite replaces rather than exercises, mirroring what [`tests/integration/vitest-setup.ts`](../app/tests/integration/vitest-setup.ts) does with `@/auth`. `usePathname` defaults to `/dashboard`; a test driving a route-dependent branch overrides per call with `vi.mocked(usePathname).mockReturnValue(...)`. |

Two things are **not** rendered, on purpose:

- **The eleven recharts wrappers (`components/charts/*-chart.tsx`).** Not
  because rendering them is hard — they mount fine — but because a mounted
  chart renders *nothing*. `ResponsiveContainer` has no layout under jsdom, so
  the DOM comes back as `{svg: 0, rect: 0, text: 0}`: the container element and
  no chart inside it. A test can therefore assert only the card title, while the
  coverage report credits 41% of the file. They are excluded from the
  denominator instead, and their logic lives in tested `.ts` siblings —
  `waterfall-bars.ts`, `debt-waterfall-bars.ts`, `timeseries-pivot.ts`,
  `accounting-axis.ts`. `gauge-badge.tsx`, the one hand-rolled SVG in that
  directory, *is* rendered and tested.
- **Anything reaching `next-auth`.** It does not resolve under vitest's jsdom
  environment (`Cannot find module 'next/server'`). Components whose children
  import a server action cut the chain with a `vi.mock` of the action module —
  see [`transaction-list.test.tsx`](../app/tests/unit/components/transaction-list.test.tsx).

One convenience worth knowing: every `next/navigation` export is a `vi.fn()`,
so a test steers `usePathname` with
`vi.mocked(usePathname).mockReturnValue("/dashboard/assets")` and asserts on
navigation by reading back the router the component itself received —
`vi.mocked(useRouter).mock.results.at(-1)!.value.push`. Calling `useRouter()`
from the test body instead is a `react-hooks/rules-of-hooks` lint error.

## Importer Tests

The importer is Python, so it sits outside Vitest entirely — a separate suite,
a separate runner, and no part of the Node coverage thresholds below.

```bash
pip install -r importer/requirements-dev.txt
cd importer
pytest tests
```

| File | Covers | Requires DB? |
|---|---|---|
| `tests/test_poll.py` | The dispatch loop — dedup, quarantine, backoff, error classification, the lookup preflight | No |
| `tests/test_lookups.py` | Name-based PK resolution — missing rows, ambiguous names, last-4 collisions | No |
| `tests/test_import_log.py` | The `import_log` constraints and the importer's privileges | Yes (`Finances_Test`) |
| `tests/test_lookups_live.py` | That the lookup maps match the schema, and that no two reference rows share a name | Yes (`Finances_Test`) |

The integration half is **skipped, not failed**, when `IMPORTER_DATABASE_URL` is
unset, so a bare `pytest tests` is always green and useful. To run it:

```bash
export IMPORTER_DATABASE_URL='postgresql://finance_importer:<pw>@localhost:5432/Finances_Test'
export ADMIN_DATABASE_URL='postgresql://postgres:<pw>@localhost:5432/Finances_Test'
pytest tests
```

It connects as `finance_importer` rather than as the superuser on purpose. The
append-only guarantee on `import_log` is a *privilege*, so asserting it from a
role that holds `UPDATE` anyway would prove nothing. `ADMIN_DATABASE_URL` is
optional and used only to clean up the rows the two commit tests leave behind —
`finance_importer` cannot `DELETE`, which is the point.

Both halves run in CI's `ci` job, after the migrations, seed and grants have
been applied — which is also what makes the integration half a live check that
`init-db/roles/02-grants.sql` was applied correctly.

### Proving these can fail

The two behaviours most worth distrusting are invisible in a passing run, so
both were checked by mutation rather than by inspection. In `importer/poll.py`:

- Move the `record_failure(...)` call *above* the `conn.rollback()` in
  `process_file` — `test_failure_is_recorded_only_after_the_rollback` goes red.
  Without that ordering the quarantine row rolls away with the parser's work and
  the file is retried on every poll forever.
- Make `is_connection_error` return `False` unconditionally —
  `test_connection_error_propagates_and_quarantines_nothing` goes red. Without
  the distinction, a routine Postgres restart quarantines every good file in the
  drop folder.

Three more were added with the lookup resolution in Issue
[#273](https://github.com/aellington89/finance-stack/issues/273), each of which
removes a *silent* wrong answer rather than a crash:

- Make `preflight_lookups` return `True` before it reads `REQUIRED_LOOKUPS` —
  `test_a_missing_declared_row_skips_the_type_without_opening_a_file` and
  `test_a_stale_map_is_reloaded_before_the_preflight_refuses` go red. Without the
  check a missing category is found one document at a time, as a quarantine each.
- Delete the ambiguity guard from `lookups.resolve` —
  `test_resolve_refuses_an_ambiguous_name` goes red. None of these name columns
  has a `UNIQUE` constraint, so without it a duplicated name resolves to
  whichever row Postgres read last.
- Make the `len(candidates) > 1` branch in `resolve_account_by_last4`
  unreachable — three `test_last4_*` cases go red. That is the old behaviour
  exactly: a replaced card silently redirects a net-pay distribution.

## Coverage

`npm run test:coverage` runs all three projects, merges the maps, and **fails if
any threshold is missed** (Issue [#142](https://github.com/aellington89/finance-stack/issues/142)).
CI runs exactly this command, as a single `Tests (with coverage)` step — the
halves are not run separately there, because a threshold over any one alone
measures the wrong thing: `lib/queries` and `lib/actions` are ~840 statements
that sit near 5% until the integration project runs, and the 41 component files
sit near 0% until the jsdom project does.

Thresholds are the measured baseline minus two points, rounded down. Two points
absorbs ordinary jitter; anything larger absorbs a regression.

| Scope | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Global | 84 | 73 | 77 | 84 |
| `lib/**/*.ts` | 83 | 71 | 80 | 84 |
| `scripts/**/*.ts` | 97 | 90 | 98 | 97 |
| `components/**/*.ts` | 97 | 94 | 98 | 97 |
| `components/**/*.tsx` | 74 | 63 | 66 | 76 |
| `hooks/**/*.ts` | 98 | 98 | 98 | 98 |

Baseline they were derived from, measured 2026-09-23 over the merged run (1066
tests, 93 files, 2677 statements): **86.1 / 75.1 / 79.9 / 86.8**. Branches is
the weak metric across every scope and the one to watch. To raise a threshold,
run the merged suite, take the new number, subtract two, and update
`app/vitest.config.ts` **and this table** in the same commit —
`thresholds.autoUpdate` is deliberately off, because it rewrites the config from
inside a CI run and the resulting diff has no author and no reason.

> **The denominator grew 62% and the number held.** Issue
> [#296](https://github.com/aellington89/finance-stack/issues/296) brought the
> React tree into the map — 1649 → 2677 statements — and the global went
> 88.3 → 86.1. That is the point of the exercise: the old figure was high partly
> because it was not asking the components anything. `lib/**/*.ts` and
> `scripts/**/*.ts` are untouched by #296 and still hold at their #142 values;
> raising them to what they now measure belongs in its own diff.

### What is measured, and what is not

The denominator is *the surface the suite can actually reach* — not "all
source". Padding it with files no test can execute makes the percentage a
constant rather than a gate, and a constant cannot detect a regression.

In: `lib/**/*.ts`, `app/api/health/**/*.ts`, `components/**/*.ts`,
`components/**/*.tsx`, `scripts/**/*.ts`, `hooks/**/*.ts`, `instrumentation.ts`
— **93 files, 2677 statements**.

Out, and why:

| Excluded | Why |
|---|---|
| `components/ui/**/*.tsx` | **Generated, not authored.** `npx shadcn add <name>` rewrites these 24 files wholesale — `ui/chart.tsx` even carries a "DIVERGES FROM UPSTREAM" notice for the one place we edited it — so gating them would turn a routine re-generation into a CI failure with no bug behind it. They still *execute*, inside the components that are gated; they are simply not held to a number. The one thing this would have dropped is `chartColorVars`, whose key filter is the security half of [#237](https://github.com/aellington89/finance-stack/issues/237); it now lives in the sibling `ui/chart-colors.ts` and stays in the denominator. |
| `app/(app)/**` | Next.js pages and layouts — not in `include` at all, and covered by [#141](https://github.com/aellington89/finance-stack/issues/141)'s [E2E suite](#end-to-end-tests) rather than by unit tests. Playwright reports no coverage into this map and is not meant to. |
| `auth.ts`, `proxy.ts` | Framework wiring the suite *replaces*: `vitest-setup.ts` mocks `@/auth` wholesale, so `auth.ts` can never report anything but 0% however well tested its dependents are. |
| `lib/db/index.ts` | The `pg` Pool singleton — construction, no branches worth gating. |
| The five `scripts/` entrypoints | argv-parsing and stdout shells. The logic each wraps lives in a sibling module (`check-changelog-core.ts`, `docs-index-check.ts`, `release-notes-core.ts`, `seed-reference-check.ts`) which stays in and sits near 100%. |
| `**/*.test.ts`, `**/*.test.tsx` | Belt-and-braces rather than load-bearing, and worth saying so: `tests/` is not in `include` and anchored globs cannot reach it. Verified by removing them and re-measuring — 2677 statements either way. Kept because vitest 4's substring matching *did* pull them in (see [trap 2](#three-glob-traps)). |

| `components/charts/*-chart.tsx` | **The eleven recharts wrappers, because a test of one cannot assert anything.** They render through `ChartContainer` → `ResponsiveContainer`, which has no layout under jsdom: a mounted chart produces `{svg: 0, rect: 0, text: 0}` — the container element and nothing inside it. Measured, not assumed. A render test therefore buys 41% of the file's statements, 2 of its 8 functions and **0% of its branches** while asserting only the card title. The `-chart.tsx` suffix is load-bearing: it keeps `gauge-badge.tsx`, the one hand-rolled SVG here, *in* the denominator, where it renders fully and is tested. |

**What Issue [#296](https://github.com/aellington89/finance-stack/issues/296)
changed here.** `**/*.tsx` and `hooks/**` used to head this table, on the
grounds that nothing could render React. The jsdom project can, so both came
in:

- `components/**/*.tsx` — 30 files at **77.0%**, which is #142's deferred
  "~70% for components" criterion, met. It first entered the denominator at
  28.8%; what moved it was emptying the chart files of logic (below) and
  writing render tests for everything else. Every file but `app-sidebar.tsx`
  now has one.
- `hooks/**/*.ts` — note the old `hooks/**` exclusion was itself
  belt-and-braces, since no `include` glob ever reached it. Measuring it meant
  *adding* `hooks/**/*.ts` to `include`, not just deleting an exclude entry.
- `components/**/*.ts` went from two incidental helpers to nine modules, all of
  them logic lifted out of `.tsx` components: the tile and bar builders
  (`debt-mix-tiles.ts`, `liquidity-tiles.ts`, `waterfall-bars.ts`,
  `debt-waterfall-bars.ts`), the shared timeseries pivots
  (`timeseries-pivot.ts`), the accounting axis formatters
  (`accounting-axis.ts`) and `chart-colors.ts`. Its threshold rose from
  78/85/82/78 to 97/94/98/97.

**Excluding the charts is what made the rest honest, and the order matters.**
The chart files were emptied *first*: eleven grouping arms of axis formatting,
three timeseries pivots and two bar builders moved into tested `.ts` siblings,
and eighteen byte-identical copies of `formatCurrency` / `formatCurrencyCompact`
/ `formatDate` / `parseDate` were consolidated into `lib/format/`. What is
excluded now is declarative recharts markup with no logic left in it. Excluding
them before that work would have hidden real code behind a plausible reason.

### Three glob traps

All three are live in `app/vitest.config.ts`, all three have already caused a
silent misconfiguration, and the comments there restate them. In short:

1. **Coverage globs resolve against `app/`, not the repo root.** `app/api/health/**`
   means `app/app/api/health/` on disk. Getting it backwards matches nothing,
   which reads in a report as "that code is uncovered" rather than as a broken
   pattern.
2. **`coverage.include` globs are anchored and mean exactly what they say — but
   they did not always.** Under vitest 4 they were applied with picomatch's
   `contains: true`, matching against any *substring* of the absolute path, so
   `components/**/*.ts` also matched `card.tsx` (because
   `components/ui/card.ts` is a substring of `.../components/ui/card.tsx`) and a
   blanket `**/*.tsx` exclusion was the only thing holding the React tree out of
   the report. **vitest 5 dropped that behaviour.** Issue #296 found out the
   hard way: removing the blanket exclusion moved the denominator by 11
   statements, and the 41 component files only appeared once
   `components/**/*.tsx` was added to `include` explicitly. If a `.tsx` file
   looks uncovered but is absent from the report altogether, this is why.
   — The same change made `coverageConfigDefaults.exclude` an empty array
   (it used to hold `**/node_modules/**` and `**/[.]**`). Nothing relies on it
   now: what keeps `node_modules` and `.next/standalone` — which contains a
   full second copy of `components/` — out of the map is simply that every
   `include` glob is anchored.
3. **Threshold globs are anchored too**, matched against the path relative to
   `app/`. This used to be the *opposite* of how `include` behaved and is now
   the same rule, so the two halves of the config finally agree. It still means
   `components/**/*.ts` gates the `.ts` helpers only and never the `.tsx`
   components. And the global block is not "everything the globs did not
   match": vitest evaluates it over every file in the map, glob-matched ones
   included, so those four numbers are additional assertions rather than a
   partition — which is why the global sits far below every per-glob figure now
   that 41 low-coverage component files are in there.

A fourth, now fixed: parentheses are extglob syntax, so the old
`exclude: ["app/(app)/test-ui/**"]` matched **nothing** and the dev playground
page was counted for as long as it existed. Escape them (`app/\(app\)/…`) or
avoid path segments that need it.

## End-to-End Tests

One [Playwright](https://playwright.dev/) spec, driving one path through a real
browser against the real build: sign in → create an account with an opening
balance → post a transaction → assert the dashboard Net Worth KPI moved by
exactly the amount posted ([Issue #141](https://github.com/aellington89/finance-stack/issues/141)).

```bash
cd app
npm run test:e2e        # headless; builds the app and starts it on :3100
npm run test:e2e:ui     # the Playwright UI runner, for writing or debugging one
```

**Every piece of that path is already covered in isolation — the wiring between
them was not, and that is the whole reason this suite exists.**
[`tests/integration/actions/transaction.test.ts`](../app/tests/integration/actions/transaction.test.ts)
calls `submitTransaction()` with a hand-built `FormData` and a mocked session;
[`tests/integration/queries/rebuild-balance.test.ts`](../app/tests/integration/queries/rebuild-balance.test.ts)
checks the SQL. Neither can fail on a renamed form field, a page that stopped
revalidating, a proxy redirect, or a KPI reading the wrong point of the series.
So the spec asserts only on what a person can see, and it reaches the database
directly in exactly two places — creating the sign-in user, and deleting what
the run created.

**It is one path on purpose.** The issue asked for one critical happy path
rather than coverage, and the second E2E test is where the suite starts costing
more maintenance than it catches regressions.

### The exception: `csp.spec.ts`

[`e2e/csp.spec.ts`](../app/e2e/csp.spec.ts) is the one spec that bends the rule
above, and it should stay the last one that does.

The nonce-based CSP ([#237](https://github.com/aellington89/finance-stack/issues/237))
has acceptance criteria that are facts about a browser and nothing else: whether
Next stamped its nonce onto its own inline scripts, whether the theme script was
refused, whether anything on the page reported a violation. A unit test can
assert the policy *string* — and
[`tests/unit/lib/security/csp.test.ts`](../app/tests/unit/lib/security/csp.test.ts)
does — but getting this wrong produces a blank page in production, which is
exactly the class of failure the E2E gate exists for.

It also avoids the cost that made one path the rule. It writes nothing to the
database, so it needs no teardown and cannot race the money path; it reuses the
session `auth.setup.ts` already establishes; and it runs in about three seconds.

The production build matters more here than anywhere else in the suite: **the
nonce only exists in one.** `next dev` serves a policy with `'unsafe-inline'`
instead (see [Security headers](deployment.md#security-headers)), so a spec run
against a dev server would pass while testing the opposite of what ships.

### How it runs

| | |
|---|---|
| Database | `Finances_Test`, seeded from `init-db/seeds/` — the same fixture the integration project uses |
| App | The **production** build: `npm run build` then `next start` on port **3100** |
| Auth | One real sign-in in [`e2e/auth.setup.ts`](../app/e2e/auth.setup.ts), saved as `storageState` and reused |
| Isolation | One worker, no parallelism |
| Cleanup | Global teardown deletes the run's accounts, transactions, balance rows and user |

Four of those are decisions rather than defaults:

- **`Finances_Test`, not a database of its own.** It is already "a fixture DB
  seeded from `init-db/`", and a second provisioning path would be a second
  thing to keep in step with `init-db/seeds/` and with
  `app/scripts/migrate-and-seed.sh` (which hardcodes `Finances_Test`). The
  guard that refuses to run against anything else is shared with the
  integration project — [`tests/support/assert-test-database.ts`](../app/tests/support/assert-test-database.ts),
  which is where it moved to so the two cannot drift.
- **The production build, not `next dev`.** Turbopack compiles a route on first
  hit, which is slower and flakier, and the dev CSP differs from the shipped one
  (`'unsafe-eval'`, `ws:` in `next.config.ts`). `next start` prints a
  `does not work with "output: standalone"` notice and then works — that notice
  is deployment advice, not a failure.
- **Port 3100.** 3001 is bound by the `start` script *and* by the `finance-app`
  container, so a suite on that port either fights the running stack or passes
  by testing it instead of the build under test. 3002 is the dev-verify port.
- **The KPI assertion is a delta, not an absolute.** The mock seed generates
  twelve months relative to `CURRENT_DATE`, so Net Worth has no fixed value; the
  spec reads the headline before and after and asserts the difference. A broken
  rebuild therefore fails as *"the KPI did not move"*.

The account type the spec picks (`Checking Account`) matters more than it looks:
it is in `account_type_category` 1, and `getCurrentNetWorth()` excludes category
2 (Restricted Asset) from Net Worth. A restricted type would make the delta zero
and the assertion vacuous.

### Proving the gate can fail

A test that has never failed is a claim, not a gate. Break the rebuild and watch
it go red:

```bash
cd app
# In lib/actions/transaction.ts, comment out the rebuildAccountBalance() call
# inside submitTransaction's auditedTransaction block.
npm run test:e2e
```

The transaction is still written and the toast still says it succeeded — what
stops is the balance history behind it, so the account's own row never leaves
the opening balance:

```
1) [chromium] › money-path.spec.ts › … › the rebuild reaches the account's own balance

  Error: expect(locator).toContainText(expected) failed
  Expected substring: "$913.11"
  Received string:    "E2E Money Path 1788030328539Open$1,234.56"
```

That is the shape to expect: the failure lands on the *account row* step, one
step before the KPI, because both read the same `account_balance_history` rows
and the account page is checked first. Revert, re-run, confirm green. Do the
same after any change to `lib/queries/rebuild-balance.ts` — this suite is the
only thing that would notice the rebuild silently stopping.

### Selectors, and the a11y fix underneath them

The combobox and currency fields were built as a *hidden* input carrying the
`name` plus a visible control carrying the value, and `<Label htmlFor={name}>`
pointed at the hidden input's `name` — which is not an `id`, so those fields had
no accessible label at all. #141 fixed that (`id` on the visible control) rather
than working around it with structural locators, so the spec addresses them the
way a screen reader does: `getByLabel("Account Type *")`.

Two things follow for anyone editing those forms. The combobox list is rendered
through a **portal**, so an option locator is page-level and not scoped inside
the `<form>`. And `DatePicker` was deliberately left alone — its trigger is a
button, needing a different fix, and no test drives it: the transaction form
already defaults to today, which is also what puts the balance row at
`CURRENT_DATE`.

### When a local run fails in a way that makes no sense

`reuseExistingServer` is on locally (and off in CI), which is what keeps
`test:e2e:ui` iteration fast — but it means **anything already listening on 3100
becomes the app under test**, including a `next start` left over from an earlier
session. A stale server whose `.next` has since been rebuilt underneath it
serves chunks that no longer exist, so every dynamic page renders the
`app/(app)/error.tsx` boundary. The suite then fails on whichever locator came
first, with a page snapshot reading `heading "Something went wrong"` — which
looks like a broken selector and is not one.

Check the port before believing the failure:

```bash
ss -lptn 'sport = :3100'    # expect no output between runs
```

### In CI

A separate `e2e` job in [`ci.yml`](../.github/workflows/ci.yml), for the same
reason the `image` job is separate: it needs a Next build and a browser download
that the database gates have no use for, and a failure should read as "the money
path broke" — or "the CSP broke" — rather than as one more red step among
fifteen. It stands
`Finances_Test` up from the same `init-db/` files as the `ci` job, but skips the
service roles and the grant matrix — the app connects as `postgres` here, as the
integration suite does and for the reasons in [Database Role Gate](#database-role-gate)
above. On failure it uploads the Playwright HTML report, with the trace and
screenshot of the failing step.

Locally the browser needs its system libraries once:

```bash
npx playwright install --with-deps chromium   # --with-deps needs sudo
```

If installing those system-wide is not an option, Playwright's own image already
has them, and `--network host` lets it reach both Postgres on 5433 and the app
it starts on 3100. Keep the tag in step with the `@playwright/test` version in
`app/package.json` — a mismatch means the browser the image ships is not the one
the client drives:

```bash
docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e DATABASE_URL -e AUTH_SECRET \
  -v "$PWD:/work" -w /work/app \
  mcr.microsoft.com/playwright:v1.62.1-noble npx playwright test
```

## Authentication in Integration Tests

Every server action starts with a `requireActionUser()` session check (Issue #120), so [`vitest-setup.ts`](../app/tests/integration/vitest-setup.ts) mocks `@/auth` with a default **authenticated** session — action tests exercise business logic without any sign-in ceremony.

That hook also inserts the matching row into `users`, and since [Issue #87](https://github.com/aellington89/finance-stack/issues/87) both halves are load-bearing: `requireAdminUser()` reads the role from the **database** rather than from the session token, so a mocked session with no backing row is refused by every admin-gated action. If a lookup-table test starts failing with "You do not have permission", that is the gate working rather than the mock being wrong.

To test the unauthenticated path, override the mock for a single call:

```ts
import type { Mock } from "vitest";
import { auth } from "@/auth";

const mockedAuth = auth as unknown as Mock;

it("rejects an unauthenticated call", async () => {
  mockedAuth.mockResolvedValueOnce(null);
  const result = await createAccount(emptyState, formData);
  expect(result.success).toBe(false);
});
```

See [`tests/integration/actions/account-auth.test.ts`](../app/tests/integration/actions/account-auth.test.ts) for the authed + unauthed pair, and [`tests/integration/auth/verify-credentials.test.ts`](../app/tests/integration/auth/verify-credentials.test.ts) for credential verification against the real `users` table (created rows are cleaned up in `afterAll`).

To test a **role**, create the `users` row you want to be and point the mock at it — the role check reads that row, so mocking the token's claim alone proves nothing. Use `mockResolvedValue` rather than `...Once`, because the admin path reads the session twice (the session/rate gate, then the role lookup), and restore the default session in `afterEach`: `fileParallelism: false` means a leaked mock reaches the next file. See [`tests/integration/actions/categories-admin.test.ts`](../app/tests/integration/actions/categories-admin.test.ts), including the stale-token case where the cookie claims `admin` and the row says `user`.

## Rate Limiting in Tests

`requireActionUser()` also applies a per-user mutation limit (Issue [#182](https://github.com/aellington89/finance-stack/issues/182)), and its counters are **module state that outlives a test file** — the integration project runs `fileParallelism: false`, so every action test in the run shares one process, and the session mock above hands them all the same user id.

`vitest-setup.ts` therefore calls `__resetAllLimits()` in a `beforeEach`. Two things follow:

- **Nothing to do in a normal test.** Counts never carry from one test to the next, so a file driving a few dozen actions cannot poison the file that runs after it.
- **A single test may not exceed the budget** — 120 guarded actions, or 5 failed sign-ins for one username. A test that needs to cross the line should spend the budget by calling the guard directly rather than by running real mutations; see [`tests/integration/actions/account-rate-limit.test.ts`](../app/tests/integration/actions/account-rate-limit.test.ts).

To move past a window instead of resetting it, spy on `Date.now()` rather than reaching for `vi.useFakeTimers()` — the sign-in path does real database I/O and a `scrypt` verification, and faking the whole timer set takes `setImmediate` out from under the `pg` driver. [`tests/integration/auth/login-rate-limit.test.ts`](../app/tests/integration/auth/login-rate-limit.test.ts) shows both.

## The Server Action Validation Contract

[`tests/integration/actions/validation-contract.test.ts`](../app/tests/integration/actions/validation-contract.test.ts) is the executable form of the [Issue #179](https://github.com/aellington89/finance-stack/issues/179) checklist. For every mutating server action it asserts that an empty payload, and a payload carrying `1.5` / `Infinity` / `2147483648` in each ID field, is rejected with an authored message that contains no driver text.

**It is self-maintaining in both directions**, which is the point: the registry is checked against the action modules' actual exports *and* against the table in [Input Validation](input-validation.md). Adding a nineteenth action fails the suite until it appears in all three places.

The sharpest assertion is the `console.error` spy. Every rejection must happen *before* the database is reached, so a log line means the action let the payload through to `actionFailure()` and tidied up afterwards — which fails the test even though the returned message looks right.

## Asserting on Log Output

Structured logging (Issue #129) is tested by spying on `console` and asserting on the **emitted string**, not on a mock of the logger — the acceptance criterion is about what an operator's `jq` actually receives, so a mocked logger would assert nothing about the format:

```ts
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const line = consoleError.mock.calls[0][0] as string;
expect(line).not.toContain("\n");              // one record, one line
expect(JSON.parse(line).action).toBe("createAccount");
```

Redaction is covered at both levels on purpose. [`tests/unit/lib/report.test.ts`](../app/tests/unit/lib/report.test.ts) models the error shapes — a pg `DatabaseError` and drizzle's `DrizzleQueryError` wrapper — while [`tests/integration/actions/logging.test.ts`](../app/tests/integration/actions/logging.test.ts) forces a real foreign-key violation through `createAccount` so those models cannot drift from what the driver actually throws. **If you change `serializeError()`, the integration test is the one that tells you the truth.** See [Observability](observability.md#redaction) for what is stripped and why.
