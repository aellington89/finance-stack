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

Tests use [Vitest](https://vitest.dev/) and are split into two projects:

| Project | Command | Requires DB? |
|---|---|---|
| Unit | `npm run test:unit` | No |
| Integration | `npm run test:integration` | Yes (`Finances_Test`) |

The [end-to-end suite](#end-to-end-tests) is Playwright rather than Vitest and
runs separately — `npm run test:e2e`.

**Unit tests** cover Zod validation schemas and pure utility functions. They run with no external dependencies.

**Integration tests** run server actions against `Finances_Test`. Ensure `DATABASE_URL` in `app/.env.local` points to `Finances_Test` before running them. The integration test global setup will throw if it detects a non-test URL.

```bash
cd app

# Run all tests
npm test

# Run only unit tests (no DB needed)
npm run test:unit

# Run only integration tests (requires Finances_Test DB)
npm run test:integration

# Generate coverage report
npm run test:coverage
```

## Coverage

`npm run test:coverage` runs both projects, merges the maps, and **fails if any
threshold is missed** (Issue [#142](https://github.com/aellington89/finance-stack/issues/142)).
CI runs exactly this command, as a single `Tests (with coverage)` step — the
unit and integration halves are not run separately there, because a threshold
over either half alone measures the wrong thing: `lib/queries` and `lib/actions`
are ~840 of the 1518 statements in the denominator and sit near 5% until the
integration project runs.

Thresholds are the measured baseline minus two points, rounded down. Two points
absorbs ordinary jitter; anything larger absorbs a regression.

| Scope | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Global | 85 | 75 | 83 | 86 |
| `lib/**/*.ts` | 83 | 71 | 80 | 84 |
| `scripts/**/*.ts` | 97 | 90 | 98 | 97 |
| `components/**/*.ts` | 78 | 85 | 82 | 78 |

Baseline they were derived from, measured 2026-08-23 over the merged run (743
tests): **87.5 / 77.3 / 85.4 / 88.1**. Branches is the weak metric across every
scope and the one to watch. To raise a threshold, run the merged suite, take the
new number, subtract two, and update `app/vitest.config.ts` **and this table** in
the same commit — `thresholds.autoUpdate` is deliberately off, because it
rewrites the config from inside a CI run and the resulting diff has no author
and no reason.

### What is measured, and what is not

The denominator is *the surface a `*.test.ts` running in a node environment can
actually reach* — not "all source". Padding it with files no test can execute
makes the percentage a constant rather than a gate, and a constant cannot detect
a regression.

In: `lib/**/*.ts`, `app/api/health/**/*.ts`, `components/**/*.ts`,
`scripts/**/*.ts`, `instrumentation.ts` — 51 files, 1518 statements.

Out, and why:

| Excluded | Why |
|---|---|
| `**/*.tsx`, `hooks/**` | **Nothing here can render React.** Both projects are `environment: node` and collect `*.test.ts` only, so a component can be imported but never mounted. [#296](https://github.com/aellington89/finance-stack/issues/296) adds a jsdom project, which is what makes this removable. |
| `app/(app)/**` | Next.js pages and layouts — same reason, plus they are covered by [#141](https://github.com/aellington89/finance-stack/issues/141)'s [E2E suite](#end-to-end-tests) rather than by unit tests. Playwright reports no coverage into this map and is not meant to. |
| `auth.ts`, `proxy.ts` | Framework wiring the suite *replaces*: `vitest-setup.ts` mocks `@/auth` wholesale, so `auth.ts` can never report anything but 0% however well tested its dependents are. |
| `lib/db/index.ts` | The `pg` Pool singleton — construction, no branches worth gating. |
| The five `scripts/` entrypoints | argv-parsing and stdout shells. The logic each wraps lives in a sibling module (`check-changelog-core.ts`, `docs-index-check.ts`, `release-notes-core.ts`, `seed-reference-check.ts`) which stays in and sits near 100%. |

Note that `components/**/*.ts` therefore covers only the two genuinely non-React
modules under `components/` (`ui/date-range-macros.ts`,
`transactions/transaction-columns.ts`). #142 asked for ~70% across all of
`components/`; that needs the renderer #296 adds. The visible cost today is that
the five `tests/unit/components/*.test.ts` files exercise pure transforms which
happen to be exported *from* `.tsx` components — those tests still run and still
gate behaviour, but their coverage is not counted until #296 moves the
transforms into sibling `.ts` modules.

### Three glob traps

All three are live in `app/vitest.config.ts`, all three have already caused a
silent misconfiguration, and the comments there restate them. In short:

1. **Coverage globs resolve against `app/`, not the repo root.** `app/api/health/**`
   means `app/app/api/health/` on disk. Getting it backwards matches nothing,
   which reads in a report as "that code is uncovered" rather than as a broken
   pattern.
2. **`coverage.include` is matched with picomatch's `contains: true`** — against
   any *substring* of the absolute path. So `components/**/*.ts` matches
   `card.tsx`, because `components/ui/card.ts` is a substring of
   `.../components/ui/card.tsx`. The explicit `**/*.tsx` exclusion is the only
   thing holding the React tree out of the report.
3. **Threshold globs behave the opposite way** — anchored, no `contains`, matched
   against the path relative to `app/`. And the global block is not "everything
   the globs did not match": vitest evaluates it over every file in the map,
   glob-matched ones included, so those four numbers are additional assertions
   rather than a partition.

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
path broke" rather than as one more red step among fifteen. It stands
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
