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
| `npm run db:pull` | Sync Drizzle schema from DB |
| `npm run db:migrate` | Apply pending migrations |

## Testing

Tests use Vitest with two separate projects:

- **Unit tests** (`tests/unit/`) — pure functions, Zod schemas, utilities. No database connection needed.
- **Integration tests** (`tests/integration/`) — server actions against `Finances_Test`. Requires `DATABASE_URL` set to the test database.

The integration test global setup (`tests/integration/setup.ts`) asserts that `DATABASE_URL` contains `Finances_Test` before any test runs, preventing accidental execution against production.

To seed the test database with sample data, see the [root README](../README.md#test-database).

See the [root README](../README.md) for full project documentation.
