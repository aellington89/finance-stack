# Testing

Covers running unit and integration tests, the static lookup-table fixtures, and the database role gate.

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
