# Testing

Covers running unit and integration tests and the static lookup-table fixtures.

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
