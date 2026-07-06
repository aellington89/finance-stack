# Finance Stack — Next.js Application

Custom finance application built with Next.js 16, TypeScript, Tailwind CSS v4, and Drizzle ORM.

## Development

```bash
# Install dependencies
npm install

# Copy environment file and configure DATABASE_URL
cp .env.local.example .env.local

# Start dev server (Turbopack, port 3001)
npm run dev
```

The app is available at http://localhost:3001. `DATABASE_URL` in `.env.local` should point to `Finances_Test` for safe local development.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with Turbopack on port 3001 |
| `npm run build` | Production build (outputs to `.next/standalone`) |
| `npm run lint` | Run ESLint |
| `npm test` | Run all tests |
| `npm run test:unit` | Unit tests only (no DB required) |
| `npm run test:integration` | Integration tests (requires `Finances_Test` DB) |
| `npm run test:coverage` | Generate coverage report in `coverage/` |
| `npm run db:generate` | Generate a migration file from a `schema.ts` change |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:pull` | Introspect DB into `schema.ts` (inspection only — `schema.ts` is the source of truth) |

## Testing

Tests use Vitest with two separate projects:

- **Unit tests** (`tests/unit/`) — pure functions, Zod schemas, utilities. No database connection needed.
- **Integration tests** (`tests/integration/`) — server actions against `Finances_Test`. Requires `DATABASE_URL` set to the test database.

The integration test global setup (`tests/integration/setup.ts`) asserts that `DATABASE_URL` contains `Finances_Test` before any test runs, preventing accidental execution against production.

To seed the test database with sample data, see [docs/database.md](../docs/database.md#test-database).

## Schema changes

`drizzle/schema.ts` is the source of truth. Edit it, then run `npm run db:generate -- --name <desc>` to produce a versioned migration in `drizzle/migrations/`. See [Making schema changes](../docs/schema-changes.md#making-schema-changes) for the full workflow.

See the [documentation index](../docs/README.md) for the full project guide set.
