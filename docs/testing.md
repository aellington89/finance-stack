# Testing

Covers running unit and integration tests, the static lookup-table fixtures, and the database role gate.

## Database Role Gate

CI verifies the least-privilege service roles (Issue #130) on every PR via [`scripts/verify-db-roles.sh`](../scripts/verify-db-roles.sh): it applies the real grant files to `Finances_Test`, asserts the whole grant matrix against the catalog, and then connects as each role to confirm that permitted statements succeed and forbidden ones are refused with `SQLSTATE 42501`. Run it yourself with:

```bash
docker compose run --rm --entrypoint bash migrate /scripts/verify-db-roles.sh Finances
```

**The integration suite still connects as `postgres`, and should stay that way.** Two of its behaviours are ones `finance_app` is deliberately not allowed: [`vitest-setup.ts`](../app/tests/integration/vitest-setup.ts) calls `setval()` on the lookup sequences (needs `UPDATE` on the sequence; the role has only `USAGE`), and [`auth/verify-credentials.test.ts`](../app/tests/integration/auth/verify-credentials.test.ts) inserts into `users` (read-only to the app role). Pointing the suite at `finance_app` would fail for exactly the reasons the grants exist — role coverage belongs in the gate above, not in the suite.

## Static Lookup Tables in Integration Tests

The integration test `beforeAll` (in [`app/tests/integration/vitest-setup.ts`](../app/tests/integration/vitest-setup.ts)) upserts the full production row set for `account_type_categories` (6 rows) and `transaction_types` (12 rows) before any test runs. This is a drift-correction safety net — the seed files already populate these tables on first launch. No manual seed step is required.

At runtime, [`/api/health`](../app/app/api/health/route.ts) performs the equivalent check live: it verifies every ID referenced from [`app/lib/constants/reference-ids.ts`](../app/lib/constants/reference-ids.ts) still resolves to its canonical seed-row name, and returns 503 with a `drift[]` array if any row is missing or renamed. See the Issue #123 changelog entry for the response shape.

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
