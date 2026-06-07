# Finance Stack

A containerized personal finance data warehouse for aggregating, storing, and visualizing multi-account financial data.

## Stack

| Service | Description | Local Port |
|---|---|---|
| PostgreSQL 18 | Primary database | 5433 |
| Next.js 16 | Custom finance application | 3001 |
| importer | File ingestion (polls `imports/` subfolders) | — |
| Metabase | BI dashboards and analytics (`--profile bi`) | 3000 |

## Security

This application has **no authentication**. Anyone who can reach the HTTP port (3001) can read, create, edit, and delete all financial data. Only expose it on a trusted network — localhost, a VPN, Tailscale, or similar — never on the public internet. A full security and integrity model (auth, authorization, audit logging, deployment hardening, backup policy) is tracked in [#100](https://github.com/aellington89/finance-stack/issues/100).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 22+](https://nodejs.org/) (for the Next.js application)

## Getting Started

### 1. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and replace the `changeme` placeholder passwords with your own values.

### 2. Start the stack

```bash
docker compose up
```

This will:
1. Start PostgreSQL and wait until it is healthy
2. Run the `migrate` service: applies pending Drizzle migrations to `Finances` and `Finances_Test`, then seeds lookup data
3. Build and start the Next.js finance application
4. Start the importer service

### Importer (`importer`)

The `importer` service automates file-to-transaction ingestion. It polls subdirectories under `imports/` every 60 seconds, routing each file to a matching parser module in `importer/parsers/`. Each line item is mapped to primary keys in the database (`accounts`, `transaction_categories`, `transaction_category_types`) and inserted as transaction rows. Unmatched fields cause a hard failure — no silent skips.

The `importer/poll.py` dispatcher is committed to the repo. The `importer/parsers/` directory and `imports/` drop folder are gitignored — parser logic is user-specific since the field mapping depends on how you categorize your transactions.

**Adding a new import type:**

1. Create a subdirectory under `imports/` (e.g., `imports/bank-statements/`)
2. Create a matching parser at `importer/parsers/bank_statements.py` (hyphens become underscores)
3. The parser module must expose a `process(filepath, conn, lookup_maps)` function
4. Drop files into the subdirectory — the importer picks them up on the next poll

Subdirectories without a matching parser are skipped with a warning.

### Start Metabase (optional)

Metabase is behind a Docker Compose profile and does not start by default. To start it:

```bash
docker compose --profile bi up metabase -d
```

To start the full stack including Metabase:

```bash
docker compose --profile bi up
```

### 3. Set up the Next.js application (local development only)

> **Note:** Steps 3 and 4 are for local development only. When running
> `docker compose up`, the Next.js app is built and started automatically
> inside a container.

```bash
cd app
cp .env.local.example .env.local
npm install
```

Edit `app/.env.local` and set `DATABASE_URL` to match your PostgreSQL credentials from `.env`.

### 4. Start the Next.js dev server (local development only)

```bash
cd app
npm run dev
```

The app starts on http://localhost:3001 with Turbopack for fast refresh.

### 5. Access the services

- **Finance App:** http://localhost:3001
- **Metabase:** http://localhost:3000 (requires `--profile bi`)
- **PostgreSQL:** `localhost:5433` (user: `postgres`, database: `Finances`)

## Database

### Schema

| Table | Description |
|---|---|
| `accounts` | All financial accounts (checking, savings, credit cards, loans, etc.) |
| `account_type_categories` | Top-level account categories (e.g. Current Asset, Current Liability) |
| `account_types` | Specific account types (e.g. Checking, Mortgage, Credit Card) |
| `transactions` | Individual financial transactions |
| `transaction_categories` | Expense/income categories (e.g. Groceries, Salary, Rent) |
| `transaction_types` | Transaction classifications (e.g. Debit, Credit, Transfer) |
| `account_balance_history` | Daily cumulative balance snapshots per account |

### Views

| View | Description |
|---|---|
| `v_transactions_full` | Fully joined transaction view with account names, types, categories, and related account info |
| `v_account_balances_current` | Current balance per account with full classification hierarchy (type, category) |
| `v_daily_totals` | Daily transaction totals grouped by transaction type (for income/expense line charts) |

### Balance History

`account_balance_history` stores daily cumulative balances for each account, filling in days with no transactions with a zero daily change.

For the production `Finances` database, the rebuild script is behind a profile and does not run automatically. To run it:

```bash
docker compose --profile init run --rm init-script
```

The `Finances_Test` database has its balance history built automatically as part of the first-launch seed (see below).

## First-launch database initialization

On the first `docker compose up` (empty Postgres data volume), [`init-db/01-create-databases.sh`](init-db/01-create-databases.sh) runs once inside the postgres container and creates the `Finances` and `Finances_Test` databases plus the Metabase role + database. It does not apply any schema or seed data.

Schema and seeding then come from the `migrate` Compose service, which runs after postgres is healthy. The migrate service:

1. Applies pending Drizzle migrations from [`app/drizzle/migrations/`](app/drizzle/migrations/) to both `Finances` and `Finances_Test`.
2. Seeds the two **shared lookup tables** (`account_type_categories`, `transaction_types`) into both databases so they start in sync. The Finances side uses `ON CONFLICT DO NOTHING` and is additionally guarded by a pre-flight row-count check — **existing Finances user data is never overwritten**, even on a manual re-run.
3. Seeds `Finances_Test` with mock data: all 19 `account_types`, all 27 `transaction_categories`, 8 accounts, and ~400 transactions spanning the past 12 months relative to `CURRENT_DATE` at seed time.
4. Rebuilds `Finances_Test.account_balance_history` so balances are up-to-date as of today.

`finance-app` and `importer` wait on `migrate: service_completed_successfully` before starting. After the migrate service exits, `Finances` contains only the shared lookups and is ready for the user (or the importer) to populate via normal application use. `Finances_Test` contains a full year of mock activity usable by integration tests and for UI development.

## Test Database

`Finances_Test` is populated automatically on first launch — no manual seeding is required. The seed artifacts live in [`init-db/seeds/`](init-db/seeds/) and are applied by the `migrate` Compose service:

| File | Purpose |
|---|---|
| `shared-lookups.sql` | 6 account type categories + 12 transaction types (runs against both DBs) |
| `finances-test-mock-data.sql` | 19 account types, 27 categories, 8 accounts, ~400 transactions with dates derived from `CURRENT_DATE` |
| `rebuild-balance-history.sql` | Mirrors `scripts/update-account-balance-history.sql`, runs against `Finances_Test` at seed time |

### Refreshing Finances_Test (dates age out)

The mock transaction dates are evaluated once, at seed time. If they drift out of the "past 12 months" window, drop and re-seed the test database:

```bash
# 1. Drop and recreate Finances_Test
docker exec postgres psql -U postgres -c 'DROP DATABASE IF EXISTS "Finances_Test";'
docker exec postgres psql -U postgres -c 'CREATE DATABASE "Finances_Test";'

# 2. Re-run the migrate service (applies migrations + reseeds Finances_Test)
docker compose run --rm migrate
```

For schema changes, see [Making schema changes](#making-schema-changes) below — never edit the database by hand.

## Making schema changes

`app/drizzle/schema.ts` is the single source of truth for the database schema. The flow for any schema change is:

1. **Edit `app/drizzle/schema.ts`** — add a column, table, index, or view.
2. **If your change adds, removes, or renames a foreign key,** also hand-update [`app/drizzle/relations.ts`](app/drizzle/relations.ts) to keep the relational query API (`db.query.*`) in sync. Drizzle's generator does not touch this file — only `drizzle-kit pull` regenerates it, and pull is inspection-only. Stale relations fail silently (relational queries return `undefined` for the missing relation with no error).
3. **Generate a migration:** `cd app && npm run db:generate -- --name <short-description>` produces a new `app/drizzle/migrations/NNNN_<description>.sql` file plus an updated snapshot under `meta/`.
4. **Review the generated SQL** — confirm it does what you expected; edit by hand if needed for things Drizzle doesn't model (e.g., `COMMENT ON TABLE`, advanced index types).
5. **Commit both the schema change and the migration** in the same PR.
6. **Migrations apply automatically** on the next `docker compose up` via the `migrate` service. To apply manually against a running stack: `docker compose run --rm migrate`.

> **Applied migration SQL files are immutable.** Once a migration has been applied anywhere (any local DB, a teammate's, or CI), never hand-edit its `.sql` file — drizzle records a hash of the file at apply time, so editing it silently desyncs the ledger from the applied schema. Ship any correction as a **new** follow-on migration (`npm run db:generate`). The op-class fix in commit `45bea06`, which edited `0000_baseline.sql` after it had already been applied, is exactly the case to avoid; it contributed to issue #157.

`npm run db:pull` is now **inspection only** — it overwrites `schema.ts` from the live DB, which is useful for verifying a migration applied as expected but should never be committed as the source of truth.

CI runs a drift gate that invokes `drizzle-kit generate` after applying migrations. If `schema.ts` diverges from the latest meta snapshot, generate produces a new migration SQL file under `drizzle/migrations/`; CI then fails the build with a message pointing at `npm run db:generate`. This catches the common case of editing `schema.ts` without running `db:generate` — without depending on `drizzle-kit pull`'s catalog introspection, which has known cosmetic non-determinism (e.g. composite-index op classes, PK column order).

### Adopting migrations on an existing database

If you've been running this stack before migrations existed, your `Finances` (and any pre-existing `Finances_Test`) have the tables but no `__drizzle_migrations` history. The first `migrate` run will try to re-apply `0000_baseline.sql` and fail on `CREATE TABLE` conflicts. To mark the baseline as already-applied without losing data, run this once before the first migrate:

```bash
# Compute the baseline hash, then insert it into every DB that already has the tables.
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('app/drizzle/migrations/0000_baseline.sql', 'utf8')).digest('hex'))")
# created_at MUST be the baseline journal `when` — the exact value drizzle-kit stores
# when it applies 0000 itself. drizzle treats a migration as applied only if the most
# recent stored created_at >= the journal `when`, so a wall-clock now() that lands
# before `when` makes drizzle re-run the baseline (issue #157). Derive it from the
# journal so it can't drift.
WHEN=$(node -e "console.log(require('./app/drizzle/migrations/meta/_journal.json').entries.find(e=>e.tag==='0000_baseline').when)")
for DB in Finances Finances_Test; do
  docker exec -i postgres psql -U postgres -d "$DB" <<EOF
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('$HASH', $WHEN);
EOF
done
```

After this, `docker compose run --rm migrate` is a no-op on existing DBs (baseline already applied) and future migrations apply normally. Drop the `Finances_Test` half of the loop if that DB doesn't exist yet.

> **Note:** the `migrate` service ([`app/scripts/migrate-and-seed.sh`](app/scripts/migrate-and-seed.sh)) also self-heals a DB that was adopted with an earlier `created_at` (e.g. by the pre-#157 `now()` procedure): it bumps any baseline row recorded before the journal `when` up to it on every run. So this manual procedure is only needed for the **very first** adoption of a brand-new DB that has no `__drizzle_migrations` table at all.

### Static lookup tables in integration tests

The integration test `beforeAll` (in [`app/tests/integration/vitest-setup.ts`](app/tests/integration/vitest-setup.ts)) upserts the full production row set for `account_type_categories` (6 rows) and `transaction_types` (12 rows) before any test runs. This is a drift-correction safety net — the seed files above already populate these tables on first launch. No manual seed step is required.

At runtime, [`/api/health`](app/app/api/health/route.ts) performs the equivalent check live: it verifies every ID referenced from [`app/lib/constants/reference-ids.ts`](app/lib/constants/reference-ids.ts) still resolves to its canonical seed-row name, and returns 503 with a `drift[]` array if any row is missing or renamed. See the Issue #123 changelog entry below for the response shape.

## Project Structure

```
finance-stack/
├── docker-compose.yml                    # Infrastructure definition
├── .env.example                          # Template for credentials (copy to .env)
├── .dockerignore                         # Excludes files from Docker build context
├── app/                                  # Next.js 16 application (App Router)
│   ├── Dockerfile                        # Multi-stage Docker build (deps → build → runner)
│   ├── .dockerignore                     # Excludes node_modules, .next, etc. from build context
│   ├── .gitignore                        # Excludes node_modules, .next, .env*, coverage
│   ├── README.md                         # App-specific development notes and scripts reference
│   ├── package.json                      # Node.js dependencies and scripts
│   ├── tsconfig.json                     # TypeScript compiler config
│   ├── next.config.ts                    # Next.js config (standalone output for Docker)
│   ├── drizzle.config.ts                 # Drizzle ORM config (schema path + migrations output dir)
│   ├── eslint.config.mjs                 # ESLint flat-config (Next.js + TypeScript rules)
│   ├── postcss.config.mjs                # PostCSS config (Tailwind CSS v4 plugin)
│   ├── .env.local.example                # Template for app env vars (copy to .env.local)
│   ├── app/                              # App Router — pages and layouts
│   │   ├── api/health/route.ts           # Health check endpoint (Docker liveness + seed-row drift detection against SEED_REFERENCES)
│   │   ├── layout.tsx                    # Root layout (fonts, ThemeProvider, Toaster)
│   │   ├── globals.css                   # Global styles and Tailwind CSS theme variables
│   │   ├── favicon.ico
│   │   ├── (landing)/                    # Route group — no sidebar
│   │   │   └── page.tsx                  #   Landing page (/)
│   │   └── (app)/                        # Route group — sidebar navigation shell
│   │       ├── layout.tsx                #   App shell (SidebarProvider + AppSidebar + SidebarInset)
│   │       ├── error.tsx                 #   Error boundary — catches unhandled errors with retry UI
│   │       ├── dashboard/                #   Tabbed dashboard — 5 sections, each with drill-down sub-tabs:
│   │       │   ├── layout.tsx            #     Layout: top-level section tabs + ensureTodayBalances()
│   │       │   ├── dashboard-tabs.tsx    #     Top-level tabs (Summary / Accounting / Transactions / Accounts / Work Expenses)
│   │       │   ├── page.tsx              #     Summary overview (/) — page-level date filter, date-aware KPI snapshot + trends
│   │       │   ├── net-worth/            #     Summary › Net Worth drill-down (allocation, drivers, decomposition, waterfall)
│   │       │   ├── assets/               #     Summary › Assets drill-down (allocation, performance, liquidity, trend)
│   │       │   ├── liabilities/          #     Summary › Liabilities drill-down (allocation, debt-mix, waterfall, debt service, performance)
│   │       │   ├── accounting/           #     Personal Accounting:
│   │       │   │   ├── page.tsx              #       Overview — charts + Income/Expenses/Investments KPI columns
│   │       │   │   ├── income/page.tsx       #       Income drill-down (stub)
│   │       │   │   ├── expenses/page.tsx     #       Expenses drill-down (stub)
│   │       │   │   ├── investments/page.tsx  #       Investments drill-down (stub)
│   │       │   │   ├── cash-flow/page.tsx    #       Cash Flow drill-down (stub)
│   │       │   │   └── budget/page.tsx       #       Budget drill-down (stub)
│   │       │   ├── transactions/         #     Transactions:
│   │       │   │   ├── page.tsx              #       Overview — filter bar + list + new-transaction form
│   │       │   │   ├── categories/page.tsx   #       Categories drill-down (stub)
│   │       │   │   ├── merchants/page.tsx    #       Merchants drill-down (stub)
│   │       │   │   └── recurring/page.tsx    #       Recurring drill-down (stub)
│   │       │   ├── accounts/             #     Accounts:
│   │       │   │   ├── page.tsx              #       Overview — visual balance sheet
│   │       │   │   ├── activity/page.tsx     #       Activity drill-down (stub)
│   │       │   │   └── reconciliation/page.tsx #     Reconciliation drill-down (stub)
│   │       │   └── work-expenses/        #     Work Expenses:
│   │       │       ├── page.tsx              #       Overview — KPIs + charts
│   │       │       └── reimbursements/page.tsx #     Reimbursements drill-down (stub)
│   │       ├── accounts/                 #   /accounts, /accounts/new, /accounts/[id]/edit
│   │       ├── settings/categories/      #   /settings/categories — CRUD for all reference-data tables
│   │       └── test-ui/                  #   /test-ui — UI component verification page
│   ├── components.json                   # shadcn/ui configuration
│   ├── drizzle/                          # Drizzle ORM schema + migrations
│   │   ├── schema.ts                     # Source of truth for schema — edit, then run db:generate
│   │   ├── relations.ts                  # Table relations for type-safe joins
│   │   └── migrations/                   # Authored migrations (versioned, applied by drizzle-kit migrate)
│   │       ├── 0000_baseline.sql         # Baseline matching current prod schema
│   │       └── meta/                     # Drizzle migration journal and snapshots
│   │           ├── _journal.json         # Ordered list of applied migrations (idx, tag, breakpoints)
│   │           └── 0000_snapshot.json    # Full schema snapshot at the 0000_baseline migration
│   ├── scripts/
│   │   ├── migrate-and-seed.sh           # Entrypoint for the `migrate` Compose service (drizzle-kit migrate + seed)
│   │   ├── check-seed-references.ts       # CI gate: SEED_REFERENCES (id, name) must match shared-lookups.sql (#155)
│   │   └── seed-reference-check.ts        # Pure parse + diff helpers backing the gate (unit-tested)
│   ├── hooks/
│   │   └── use-mobile.ts                 # Mobile breakpoint detection hook (used by sidebar)
│   ├── components/
│   │   ├── app-sidebar.tsx               # Global sidebar navigation (Dashboard, Accounts, Settings)
│   │   ├── ui/                           # shadcn/ui primitives + custom wrappers
│   │   │   ├── combobox.tsx              # Searchable select dropdown (custom)
│   │   │   ├── currency-input.tsx        # Numeric currency entry with symbol prefix (custom)
│   │   │   ├── date-picker.tsx           # Single-date calendar popover (custom)
│   │   │   ├── date-range-picker.tsx     # Date range with quick-select presets + manual input (custom)
│   │   │   ├── date-range-macros.ts      # Saved Quick Select macros: types, built-in defaults, localStorage helpers
│   │   │   └── input-group.tsx           # Input with inline prefix/suffix slot (custom)
│   │   ├── charts/                       # Chart components (client components)
│   │   │   ├── accounting-chart.tsx      # Time-series area chart for income/expenses/investments (Chart.js)
│   │   │   ├── expenses-category-chart.tsx # Donut chart for expense category breakdown (Chart.js)
│   │   │   ├── work-expenses-chart.tsx   # Grouped bar chart for work expenses vs reimbursements over time
│   │   │   ├── net-worth-chart.tsx       # Reusable time-series line chart (Recharts)
│   │   │   ├── waterfall-chart.tsx       # Net worth waterfall analysis chart (Recharts)
│   │   │   ├── net-worth-timeseries-chart.tsx # Multi-series decomposition chart for net-worth drill-down (Recharts)
│   │   │   ├── asset-allocation-chart.tsx # Treemap of assets by category → account type (Recharts)
│   │   │   ├── assets-timeseries-chart.tsx # Stacked area chart of asset balances by category (Recharts)
│   │   │   ├── liability-allocation-chart.tsx # Treemap of liabilities by category → account type (Recharts)
│   │   │   ├── liabilities-timeseries-chart.tsx # Stacked area chart of liability balances by category (Recharts)
│   │   │   ├── debt-waterfall-chart.tsx  # Debt waterfall (Start → Payments → Interest → Other → End) (Recharts)
│   │   │   └── gauge-badge.tsx           # Custom SVG semicircular gauge with range segments
│   │   ├── accounts/                     # Accounts page components
│   │   │   ├── accounts-table.tsx        # Two-column balance sheet with expand/collapse; exports amountColorClass()
│   │   │   ├── accounts-by-category.tsx  # Grouped card view: Assets (2x2) + Liabilities, with per-type + icon
│   │   │   ├── account-form.tsx          # Create/edit account form with combobox type selector
│   │   │   └── delete-account-dialog.tsx # Delete confirmation dialog with transaction check
│   │   ├── settings/                     # Settings page components
│   │   │   ├── entity-card.tsx           # Reusable card for flat entities (name-only CRUD)
│   │   │   ├── account-types-card.tsx    # Account Types card with types nested under category
│   │   │   ├── entity-dialog.tsx         # Add/edit modal dialog (name + optional category combobox)
│   │   │   └── delete-entity-dialog.tsx  # Delete confirmation dialog with in-use guard
│   │   ├── dashboard/                    # Dashboard-specific components
│   │   │   ├── page-header.tsx           # Standard page header — optional sub-nav + h1 title + filter bar below (shared by all dashboard pages)
│   │   │   ├── drilldown-tabs.tsx        # Config-driven drill-down sub-tabs for every section (DRILLDOWN_SECTIONS source of truth)
│   │   │   ├── coming-soon.tsx           # Placeholder body for scaffolded drill-down pages not yet built out
│   │   │   ├── accounting-filters.tsx    # Label-less multi-select combobox filter bar for accounting page
│   │   │   ├── accounting-kpi-card.tsx   # KPI card with change indicator for accounting metrics
│   │   │   ├── date-range-filter.tsx     # URL-param-driven date range filter wrapper
│   │   │   ├── date-range-error.tsx       # Inline "Invalid date range" error state (rendered when validateDateRange rejects params)
│   │   │   ├── net-worth-drivers-table.tsx # Expandable net worth drivers table (category → account type → account)
│   │   │   ├── asset-performance-table.tsx # Expandable assets performance table (category → account type → account)
│   │   │   ├── liquidity-breakdown.tsx   # Liquidity classification tiles + stacked bar
│   │   │   ├── liability-performance-table.tsx # Expandable liability performance table (category → account type → account)
│   │   │   ├── debt-mix-breakdown.tsx    # Debt mix tiles per account type (current vs. long-term)
│   │   │   └── debt-service-summary.tsx  # Period payments, interest accrued, estimated principal paid + per-account sub-table
│   │   └── transactions/                 # Transaction-specific components
│   │       ├── transaction-form.tsx      # Transaction entry form (client component)
│   │       ├── transaction-list.tsx      # Sortable transaction table with inline edit + delete (client component)
│   │       ├── transaction-edit-row.tsx  # Inline row-edit form (client component, uses updateTransaction action)
│   │       ├── transaction-delete-dialog.tsx # Delete confirmation modal (uses deleteTransaction action)
│   │       ├── transaction-filters.tsx   # Label-less filter bar with date range, multi-select, amount
│   │       └── transaction-columns.ts    # Shared ColumnKey type + visible-columns cookie helpers (server- and client-safe)
│   ├── lib/                              # Shared libraries
│   │   ├── constants/reference-ids.ts    # Centralized seed-row references (id + canonical name) and SEED_REFERENCES driver for the /api/health drift check
│   │   ├── db/index.ts                   # Drizzle ORM client (PostgreSQL connection)
│   │   ├── actions/utils.ts              # Shared ActionState type and buildFieldErrors() helper
│   │   ├── actions/transaction.ts        # Server action for transaction submission
│   │   ├── actions/account.ts            # Server actions for account create, update, delete
│   │   ├── actions/categories.ts         # Server actions for category/type create, update, delete
│   │   ├── queries/_aggregates.ts        # Shared SQL aggregation fragments (sum-by-type, balance-at-date)
│   │   ├── queries/accounts.ts           # Account balance queries (ROLLUP aggregation)
│   │   ├── queries/accounting.ts         # Accounting queries (time series, period totals, category breakdown, averages)
│   │   ├── queries/work-expenses.ts      # Work expense queries (period totals, time series, category breakdown)
│   │   ├── queries/dashboard.ts          # Dashboard queries (net worth, time series)
│   │   ├── queries/net-worth-drilldown.ts # Net worth drill-down queries (waterfall, drivers, decomposition)
│   │   ├── queries/assets-drilldown.ts   # Assets drill-down queries (allocation, performance, liquidity, decomposition)
│   │   ├── queries/liabilities-drilldown.ts # Liabilities drill-down queries (allocation, performance, decomposition, debt service, waterfall)
│   │   ├── queries/liability-categories.ts # Pinned transaction_category_ids for debt payments and interest expense
│   │   ├── queries/rebuild-balance.ts    # Per-account balance history rebuild
│   │   ├── queries/transactions.ts       # Transaction queries (filtered, sorted, form options)
│   │   ├── queries/date-range.ts         # Shared dateFrom/dateTo URL-param parsing + 30-day default
│   │   ├── queries/categories.ts         # Queries for all four reference-data tables
│   │   ├── format/financial.ts           # Shared signed-currency, change-color, percent helpers (used by asset + liability tables)
│   │   ├── forms/transaction.ts          # Post-submit state helper (persists Date, Account, Type across submits)
│   │   ├── validations/account.ts        # Zod schema for account form validation
│   │   ├── validations/transaction.ts    # Zod schema for transaction form validation
│   │   ├── validations/categories.ts     # Zod schemas for category/type forms
│   │   ├── validations/date-range.ts     # Canonical dateFrom/dateTo validator (format + ordering) + isValidIsoDate
│   │   └── utils.ts                      # Utility helpers (cn() class merge)
│   ├── tests/                            # Vitest test suite
│   │   ├── unit/                         # Unit tests (no DB required)
│   │   │   ├── validations/              #   Zod schema tests (account, transaction, categories, date-range)
│   │   │   ├── actions/                  #   Action utility tests (buildFieldErrors)
│   │   │   ├── components/               #   Component function tests (waterfall transform, liquidity, asset perf, debt-mix, debt-waterfall, liability perf, date-range macros)
│   │   │   ├── scripts/                  #   Build-tooling tests (seed-reference gate parse + diff)
│   │   │   └── lib/                      #   Library utility tests
│   │   │       ├── utils.test.ts         #     cn() class-merge helper
│   │   │       ├── forms/                #     Form helpers (transaction post-submit state)
│   │   │       ├── format/               #     Formatters (signed-currency, change-color, percent helpers)
│   │   │       └── queries/              #     Query helpers (liability-categories pinned IDs, date-range param parsing)
│   │   └── integration/                  # Integration tests (requires Finances_Test DB)
│   │       ├── setup.ts                  #   Global setup — asserts test DB URL
│   │       ├── vitest-setup.ts           #   Per-test setup/teardown
│   │       ├── actions/                  #   Server action tests (account, transaction)
│   │       ├── api/                      #   API route tests (health drift check)
│   │       └── queries/                  #   Query function tests (accounting, rebuild-balance, drilldowns)
│   └── vitest.config.ts                  # Vitest configuration (unit + integration projects)
├── importer/                              # File import service
│   ├── poll.py                            # Polling loop and parser dispatcher (committed)
│   └── parsers/                           # One module per import type (gitignored)
├── imports/                               # Drop folders — one per import type (gitignored)
├── .github/workflows/ci.yml             # CI: schema-drift + seed-reference gates, lint, unit + integration tests
├── .vscode/extensions.json              # Recommended VS Code extensions for this project
├── init-db/
│   ├── 01-create-databases.sh            # First-run DB + Metabase role creation only (auto-runs on empty data dir)
│   └── seeds/                            # Applied by the `migrate` Compose service after migrations
│       ├── shared-lookups.sql            # account_type_categories + transaction_types (both DBs)
│       ├── finances-test-mock-data.sql   # account_types, transaction_categories, accounts, ~400 txns (Finances_Test only)
│       └── rebuild-balance-history.sql   # Balance history rebuild for Finances_Test post-seed
└── scripts/
    └── update-account-balance-history.sql   # Balance history rebuild script (manual / --profile init)
```

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

---

## Stopping the Stack

```bash
docker compose down
```

Data is persisted in Docker volumes and will be available on next startup.

## Updates

### 2026-06-07 — v0.1.3.1 (in progress)

**Extract `amountColorClass` + shared SQL aggregations ([Issue #134](https://github.com/aellington89/finance-stack/issues/134))**
- `amountColorClass()` — a pure Tailwind text-color helper — lived inside the [`accounts-table.tsx`](app/components/accounts/accounts-table.tsx) component and was re-imported from there into [`transaction-list.tsx`](app/components/transactions/transaction-list.tsx). It was also byte-for-byte identical to `changeColor()` already in [`app/lib/format/financial.ts`](app/lib/format/financial.ts) (same green/red/empty logic), so the codebase carried two names for one behavior. Consolidated to a single `amountColorClass` in `financial.ts`; deleted `changeColor` and repointed its call sites in [`liabilities/page.tsx`](app/app/(app)/dashboard/liabilities/page.tsx), [`asset-performance-table.tsx`](app/components/dashboard/asset-performance-table.tsx), and [`liability-performance-table.tsx`](app/components/dashboard/liability-performance-table.tsx). Pure rename/move — the function body is unchanged, so every call site emits the same classes and there is no UI change.
- Two `SUM(CASE WHEN …)` SQL blocks were copy-pasted across the query layer, risking divergent null/rounding handling: a *sum-by-transaction-type* block (`SUM(CASE WHEN t.transaction_type_id = X THEN ABS(t.amount) ELSE 0 END)`) in [`accounting.ts`](app/lib/queries/accounting.ts) and [`work-expenses.ts`](app/lib/queries/work-expenses.ts), and a *balance-snapshot-at-date* block (`COALESCE(SUM(CASE WHEN abh.balance_date = X THEN abh.cumulative_balance ELSE 0 END), 0)`) in [`net-worth-drilldown.ts`](app/lib/queries/net-worth-drilldown.ts), [`assets-drilldown.ts`](app/lib/queries/assets-drilldown.ts), and [`liabilities-drilldown.ts`](app/lib/queries/liabilities-drilldown.ts). Both now come from `sumAmountByType()` / `balanceAtDate()` in the new [`app/lib/queries/_aggregates.ts`](app/lib/queries/_aggregates.ts) — establishing the `_`-prefixed shared-helper convention for the queries layer. Mechanical extraction only: the generated SQL (and thus query output) is unchanged.
- New unit tests: [`tests/unit/lib/queries/_aggregates.test.ts`](app/tests/unit/lib/queries/_aggregates.test.ts) renders each fragment via Drizzle's `PgDialect` and asserts the exact parameterized SQL (with/without a predicate; string date vs `CURRENT_DATE`), and the `changeColor` block in [`tests/unit/lib/format/financial.test.ts`](app/tests/unit/lib/format/financial.test.ts) was renamed to `amountColorClass` (same behavior contract). The existing drilldown integration suites guard that the Pattern B query output is unchanged; a new [`tests/integration/queries/accounting.test.ts`](app/tests/integration/queries/accounting.test.ts) closes the prior coverage gap on the Pattern A files — it seeds a dedicated account with controlled transactions and asserts exact period totals, monthly buckets, to-date comparison, expense-category breakdown, and trailing-12-month averages (incl. the empty-range → zero path).

**Centralize date-range validation ([Issue #150](https://github.com/aellington89/finance-stack/issues/150))**
- `dateFrom`/`dateTo` URL params were handled inconsistently across three layers: [`getDateRangeFromParams()`](app/lib/queries/date-range.ts) **silently swapped** an out-of-order range and did no format check; [`accounting.ts`](app/lib/queries/accounting.ts) and [`work-expenses.ts`](app/lib/queries/work-expenses.ts) each carried a private `safeDate`/`DATE_RE` that silently dropped bad dates; and the dashboard/assets/net-worth queries fed params straight into a SQL `::date` cast, so a malformed value (e.g. `?dateFrom=banana`) surfaced as a raw Postgres 500 → generic "Something went wrong". The net effect was wrong-but-silent results or opaque errors.
- New single source of truth at [`app/lib/validations/date-range.ts`](app/lib/validations/date-range.ts): `validateDateRange(params)` (a `zod/v4` schema) checks each value is a real `YYYY-MM-DD` calendar date — rejecting bad formats (`2024-1-1`) and impossible dates (`2024-02-30`, `2024-13-01`) — and enforces `dateFrom <= dateTo` via lexical compare. Ordering is now **rejected, not swapped**. The exported `isValidIsoDate()` primitive replaces the two duplicated `DATE_RE`/`safeDate` copies in the query layer (kept there as defense-in-depth).
- All eight date-aware dashboard pages now validate at the boundary (after `await searchParams`) and, on failure, render the new [`DateRangeError`](app/components/dashboard/date-range-error.tsx) inline state — a clear "Invalid date range" message that keeps the page header + date filter visible so the user can correct the range — instead of querying with bad input. `getDateRangeFromParams()` keeps its coercion + 30-day-default job but no longer swaps.
- New unit tests in [`tests/unit/validations/date-range.test.ts`](app/tests/unit/validations/date-range.test.ts) (validator: accept/reject matrix, coercion, `isValidIsoDate` truth table) and [`tests/unit/lib/queries/date-range.test.ts`](app/tests/unit/lib/queries/date-range.test.ts) (guards that out-of-order input is no longer swapped). Does not change the date-range picker UX ([#61](https://github.com/aellington89/finance-stack/issues/61)).

**Add CI gate: SEED_REFERENCES names must match shared-lookups.sql ([Issue #155](https://github.com/aellington89/finance-stack/issues/155))**
- #123's [`/api/health`](app/app/api/health/route.ts) drift check catches *DB-side* drift (the live DB diverging from code) but not *code-side* drift: renaming a row in [`init-db/seeds/shared-lookups.sql`](init-db/seeds/shared-lookups.sql) and silencing the resulting health failure by editing [`reference-ids.ts`](app/lib/constants/reference-ids.ts) to match leaves both checks green while code and seed silently disagree about a clean install. A build-time gate closes that gap.
- New [`app/scripts/check-seed-references.ts`](app/scripts/check-seed-references.ts) imports the real `SEED_REFERENCES` and cross-checks each `(table, id, name)` against the matching `INSERT … VALUES` row parsed from `shared-lookups.sql`, failing with a `::error::` line naming `(table, id, code-side name, seed-side name)` — mirroring the existing Schema drift gate's annotation + remediation-hint style. The parse/diff logic lives in side-effect-free [`app/scripts/seed-reference-check.ts`](app/scripts/seed-reference-check.ts) so it is unit-testable.
- **Directional + fail-closed:** every constant must match the seed, but unreferenced seed rows are fine; a referenced table with no `INSERT` block fails the gate *unless* it is in an explicit allowed-absent set. `transaction_categories` (the `OPENING_BALANCE_CATEGORY` "Other" row) is the sole allowed-absent table — it is intentionally not in `shared-lookups.sql` (row-level protection tracked in [#109](https://github.com/aellington89/finance-stack/issues/109)).
- Wired into [`.github/workflows/ci.yml`](.github/workflows/ci.yml) as a new "Seed reference gate" step beside the Schema drift gate (no DB needed) and runnable locally via `npm run check:seed-references`; adds `tsx` as a devDependency so the gate can import the `@/`-aliased TS source directly. New unit tests in [`tests/unit/scripts/seed-reference-check.test.ts`](app/tests/unit/scripts/seed-reference-check.test.ts) cover the deliberate rename-trips-the-gate case plus missing-row, fail-closed missing-table, the allowlist skip, `''`-unescaping, and the directional extra-rows case.

**Fix baseline re-application on adopted DBs ([Issue #157](https://github.com/aellington89/finance-stack/issues/157))**
- `drizzle-kit migrate` was re-running `0000_baseline.sql` on any DB that adopted the existing schema via the README's one-time `INSERT INTO drizzle.__drizzle_migrations` (the real `Finances` and `Finances_Test`), failing with `relation "account_balance_history" already exists` (`42P07`) and blocking every new migration (e.g. #127's indexes). Root cause: drizzle treats a migration as applied only if the most-recent stored `created_at >= ` the journal `when`, but the adoption procedure recorded `created_at = now()` (wall-clock at adoption), which landed ~2.6h *before* the baseline journal `when` (`1779422763028`) — so drizzle considered the baseline pending. Fresh DBs (CI, new clones) were never affected.
- [`app/scripts/migrate-and-seed.sh`](app/scripts/migrate-and-seed.sh) now self-heals before each migrate: it derives the baseline journal `when` from `meta/_journal.json` (via node, so it tracks the file) and bumps any migration row recorded earlier than it up to that value — exactly what `drizzle-kit` stores when it applies the baseline itself (`folderMillis = journalEntry.when`). The `UPDATE … WHERE created_at < <when>` is idempotent (a no-op once corrected, a no-op on fresh DBs where the table doesn't exist yet via a `to_regclass` guard) and only ever touches the baseline row — `0001+` rows carry a larger `when`. This auto-corrects the real `Finances` DB on the next `docker compose run --rm migrate` with no manual SQL.
- The [Adopting migrations on an existing database](#adopting-migrations-on-an-existing-database) procedure now records `created_at` = the baseline journal `when` (derived from `meta/_journal.json`) instead of wall-clock `now()`, so a first-time adoption satisfies drizzle's `>= when` check directly.
- Added guidance under [Making schema changes](#making-schema-changes) that **applied migration SQL files are immutable** — never hand-edit a `.sql` that has been applied anywhere; ship corrections as a new follow-on migration. The op-class edit to `0000_baseline.sql` in commit `45bea06` (after it had already been applied) is the cautionary case, and is why adopted DBs carry a stale baseline hash (`dfaa6f96…`) vs the current file (`0080c535…`) — cosmetic, since drizzle keys the apply decision on `created_at`, not the hash.

**Add missing DB indexes — related_account_id, balance history ([Issue #127](https://github.com/aellington89/finance-stack/issues/127))**
- New migration [`app/drizzle/migrations/0001_add_indexes_related_account_and_abh.sql`](app/drizzle/migrations/0001_add_indexes_related_account_and_abh.sql) (authored from `schema.ts` via `npm run db:generate`) adds two indexes; applied to `Finances` and `Finances_Test` by the `migrate` service. No query-result changes.
- `idx_transactions_related_account_id` — **partial** index on `transactions(related_account_id) WHERE related_account_id IS NOT NULL`. Backs the `related_account_id = $1` lookups in [`accountHasTransactions()`](app/lib/queries/accounts.ts) and the account delete/reassign path in [`lib/actions/account.ts`](app/lib/actions/account.ts) (previously a full table scan), plus the FK-integrity check on parent-account delete. Partial because only transfers populate the column.
- `idx_abh_account_date` — `account_balance_history(account_id, balance_date DESC)`, for the latest-balance-per-account lookups in [`ensureTodayBalances()`](app/lib/queries/rebuild-balance.ts) and `v_account_balances_current`. Note this overlaps the table's existing `(account_id, balance_date)` primary key, which already serves those via a backward index scan, so the marginal gain is small; added per the issue. (The generated SQL needed a hand-added `DESC` — drizzle-kit 0.31 records the descending order in the snapshot but drops the keyword from `CREATE INDEX`.)

**Centralize hardcoded reference-data IDs ([Issue #123](https://github.com/aellington89/finance-stack/issues/123))**
- Magic seed-row IDs that were duplicated across 6 files (`OPENING_BALANCE_TYPE_ID = 12`, `INCOME_TYPE_ID = 4`, `EXPENSE_TYPE_ID = 2`, `INVESTMENT_TYPE_ID = 10`, `WORK_EXPENSE_TYPE_ID = 5`, `REIMBURSEMENT_TYPE_ID = 6`, `NET_WORTH_EXCLUDED_CATEGORY_ID = 2`, `LIABILITY_CURRENT_CATEGORY_ID = 5`, `LIABILITY_NON_CURRENT_CATEGORY_ID = 6`, `OPENING_BALANCE_CATEGORY_ID = 6`) now live in a single source of truth at [`app/lib/constants/reference-ids.ts`](app/lib/constants/reference-ids.ts). Each constant is a `{ id, name } as const` record so the canonical seed-row name travels with the ID. Callsites in [`lib/actions/account.ts`](app/lib/actions/account.ts), [`lib/queries/accounting.ts`](app/lib/queries/accounting.ts), [`lib/queries/work-expenses.ts`](app/lib/queries/work-expenses.ts), [`lib/queries/dashboard.ts`](app/lib/queries/dashboard.ts), [`lib/queries/net-worth-drilldown.ts`](app/lib/queries/net-worth-drilldown.ts), and [`lib/queries/liability-categories.ts`](app/lib/queries/liability-categories.ts) now reference the records via `.id`. The legacy `LIABILITY_CURRENT_CATEGORY_ID` / `LIABILITY_NON_CURRENT_CATEGORY_ID` / `LIABILITY_CATEGORY_IDS` exports remain (derived from the new records) so [`liabilities-drilldown.ts`](app/lib/queries/liabilities-drilldown.ts) and the existing liability-categories unit test work unchanged. The user-data category arrays `DEBT_PAYMENT_CATEGORY_IDS` and `DEBT_INTEREST_CATEGORY_IDS` are intentionally untouched — they reference user-mutable `transaction_categories` rows, not seed lookups.
- [`/api/health`](app/app/api/health/route.ts) is no longer a bare `SELECT 1` liveness probe — it also performs a per-request seed-drift check. For each seed table (`transaction_types`, `account_type_categories`, `transaction_categories`) it runs one batched `SELECT id, name … WHERE id IN (…)`, compares against the `SEED_REFERENCES` array in `reference-ids.ts`, and returns `503` with a `drift[]` array (`{ table, id, expected, actual }`) listing any missing or renamed rows. Happy path remains `{ status: "ok", db: "connected", seedData: "ok" }`. Note: the `OPENING_BALANCE_CATEGORY` ("Other", id=6) row lives in `transaction_categories`, which is editable via `/settings/categories` — renaming it through the UI will intentionally trip the drift check until [#109](https://github.com/aellington89/finance-stack/issues/109) lands row-level protection.
- New integration test [`tests/integration/api/health.test.ts`](app/tests/integration/api/health.test.ts) covers both branches: the happy path returns 200 + `seedData: "ok"`, and renaming the "Opening Balance" `transaction_types` row produces a 503 whose `drift[]` entry exactly identifies the (table, id, expected, actual). The test restores the canonical name in `afterEach`, so a within-suite failure cannot leak to neighbouring tests — and the suite-wide `beforeAll` upsert in [`vitest-setup.ts`](app/tests/integration/vitest-setup.ts) is a second safety net.

**Adopt a real Drizzle migration system ([Issue #121](https://github.com/aellington89/finance-stack/issues/121))**
- `app/drizzle/schema.ts` is now the single source of truth for the database schema. The hand-maintained `init-db/schema.sql` (previously `pg_dump`ed from prod) and the commented-out `0000_initial_schema.sql` are deleted; `drizzle-kit pull` is demoted to inspection-only.
- New baseline migration at `app/drizzle/migrations/0000_baseline.sql` reproduces the full current prod schema (7 tables, 5 indexes, 7 FKs, 3 views, 2 `liquidity_class` CHECK constraints, 2 table COMMENTs). Future schema changes are authored via `npm run db:generate -- --name <desc>` and committed as versioned migration files.
- New `migrate` Compose service (built from `app/Dockerfile` `target: migrate`, with `postgresql-client` for psql + `drizzle-kit` from devDeps) runs once per `docker compose up` after postgres is healthy: applies `drizzle-kit migrate` to both `Finances` and `Finances_Test`, then runs the three existing seed files (the row-count guard that protects existing Finances data moved into [`app/scripts/migrate-and-seed.sh`](app/scripts/migrate-and-seed.sh)). `finance-app` and `importer` now `depends_on: migrate.service_completed_successfully`.
- [`init-db/01-create-databases.sh`](init-db/01-create-databases.sh) is slimmed down to DB + Metabase role creation only — no more schema or seed application from the postgres init container, which avoided the chicken-and-egg of needing tables before migrations could create them.
- CI workflow updated: postgres bumped to 18 for compose parity, `psql -f schema.sql` replaced with `npm run db:migrate`, and a new "Schema drift gate" step runs `drizzle-kit generate` after migration and fails the build if a new migration SQL file appears under `drizzle/migrations/` — pointing the contributor at `npm run db:generate`. (An earlier draft used `drizzle-kit pull` + diff, but pull's catalog introspection has cosmetic non-determinism that produced false positives.)
- [`app/tests/integration/vitest-setup.ts`](app/tests/integration/vitest-setup.ts) lost its hand-rolled `ADD COLUMN IF NOT EXISTS liquidity_class` block (dead code once migrations own that column). Lookup upserts below remain as test-state self-healing.
- Existing local `Finances` DBs with real data adopt the baseline via a one-time `INSERT INTO drizzle.__drizzle_migrations` documented in the [Making schema changes](#making-schema-changes) section. No data loss.

### 2026-05-17 — v0.1.3

**Dashboard layout standardization**
- Every dashboard page now shares one layout contract via the new [page-header.tsx](app/components/dashboard/page-header.tsx) (`DashboardPageHeader`): optional sub-nav tabs, an `<h1>` page title, then an optional filter bar on its own row directly below the title. Replaces the previous mix of in-card titles, title-less pages, and filters living variously inside card headers or beside the title.
- Titles normalized to short names — `Summary`, `Net Worth`, `Assets`, `Liabilities`, `Personal Accounting`, `Transactions`, `Accounts`, `Work Expenses` — dropping the inconsistent "Analysis"/"Overview" suffixes and adding titles to the previously title-less Summary/Transactions/Accounts pages.
- Summary's date filter is now page-level instead of scoped to the "Historical Trends" card. The Key Performance Metrics snapshot is taken as of the latest balance point within the selected range (card description reads "As of <date>"); with the default range (no end date) the last point is today, so the default view is unchanged. `dashboard/page.tsx` derives the headline from the time series rather than the always-current `getCurrentNetWorth()`.
- Removed the redundant inline `FilterIndicator` text from the Personal Accounting page — active filters are already visible in the header filter bar (`FilterIndicator`, `FilterSegment`, and `TIME_GROUPING_LABELS` deleted; ≈−190/+115 lines on that page).
- Filter bars no longer render per-control `<Label>`s: `FilterSlot` in [transaction-filters.tsx](app/components/transactions/transaction-filters.tsx) and [accounting-filters.tsx](app/components/dashboard/accounting-filters.tsx) is now a plain sizing wrapper, matching the label-less date-range pages. Container alignment changed `items-end` → `items-center`; the Amount field's placeholder became `"Amount, e.g. 50.00"` so it stays self-explanatory without a label.
- Filter controls on the Personal Accounting and Transactions pages no longer force `text-xs` (and redundant `h-8`) on their date-range pickers, comboboxes, chips, inputs, and selects. They now render at the default control size (`h-8` / `text-sm`), matching `DashboardDateRangeFilter` on the other pages — the two filter bars previously looked noticeably smaller than the rest of the dashboard.

**Config-driven drill-down sub-tabs for every section**
- `summary-drilldown-tabs.tsx` (Summary-only) replaced by the generic [drilldown-tabs.tsx](app/components/dashboard/drilldown-tabs.tsx). `DRILLDOWN_SECTIONS` is the single source of truth for every section's sub-tabs; the active tab is the one whose `href` is the longest prefix of the current path, so "Overview" (the section root) never shadows its own drill-downs and no section needs bespoke matching logic. Adding a real drill-down later is one config line plus the page.
- All five sections now carry a drill-down sub-tab bar (rendered through `DashboardPageHeader`'s `subnav` slot): Summary (Overview · Net Worth · Assets · Liabilities — existing), Personal Accounting (Overview · Income · Expenses · Investments · Cash Flow · Budget), Transactions (Overview · Categories · Merchants · Recurring), Accounts (Overview · Activity · Reconciliation), Work Expenses (Overview · Reimbursements).
- Scaffolded the 11 new drill-down routes as stubs so the tab bars are fully clickable now; each uses the standard header plus a shared [coming-soon.tsx](app/components/dashboard/coming-soon.tsx) placeholder and is trivial to replace when built out.
- Verified with `npm run typecheck` and `npm run lint`. No data-layer or URL-param contract changes.

### 2026-05-14

**Quick Select macros for the Date Range Picker ([Issue #61](https://github.com/aellington89/finance-stack/issues/61))**
- The Date Range Picker's Quick Select panel now lists four built-in one-click presets (Last 7 days, Last 30 days, This month, This year) above the existing `Last/This + count + Days/Weeks/Months/Years` builder. Built-ins are non-deletable and never stored — they always reflect today's date, so "Last 30 days" stays a rolling window.
- Users can save the current builder configuration as a named macro via a new **Save as…** button next to Apply. Saved macros appear under a "Saved" header between the built-ins and the builder. Hover a saved macro to reveal a delete affordance. Clicking any macro (built-in or saved) applies the range and closes the popover — same path as Apply.
- Macros are persisted in `localStorage` under the key `dateRangeMacros` as `{ version: 1, macros: [...] }`. This diverges from the cookie-based persistence used elsewhere in the repo (`txn-visible-columns`, `sidebar_state`) because macros are pure client-side UI state — never read server-side, never affect initial HTML, never participate in auth — which is the standard industry choice for this class of preference (see [Issue #118](https://github.com/aellington89/finance-stack/issues/118) for evaluating whether the existing cookie usages should also move). All localStorage access is wrapped so private-mode browsers degrade gracefully: built-ins still work, saves no-op silently.
- Names are trimmed, capped at 50 characters, deduplicated case-insensitively (including against built-in names), and limited to a hard cap of **10 user macros**. The Save as… button is disabled at the cap; the in-input save attempt surfaces a `"Macro limit reached — delete one to add another"` error inline.
- Both consumers — the Transactions filter ([transaction-filters.tsx](app/components/transactions/transaction-filters.tsx)) and the Dashboard date filter ([date-range-filter.tsx](app/components/dashboard/date-range-filter.tsx)) — pick up macros automatically with no code changes; the picker's `onChange(from, to)` contract is unchanged.
- New module `app/components/ui/date-range-macros.ts` is the schema source of truth for the `Scope` and `Unit` types (previously inlined in `date-range-picker.tsx`) and exports defensive `parseStoredMacros`, `loadMacros`, `saveMacros`, `addMacro`, and `deleteMacro` helpers. Unit tests in `tests/unit/components/date-range-macros.test.ts` cover parse defensiveness (malformed JSON, invalid scope/unit, name length, missing fields), dedupe rules, the cap, delete semantics, and the localStorage-unavailable path via stubbed globals.

### 2026-05-13

**Transactions column visibility: cookie-backed persistence (Issue #106)**
- Moved Transactions table column-visibility persistence from `localStorage` to a `txn-visible-columns` cookie (`Path=/; SameSite=Lax; Max-Age=1 year`, URL-encoded JSON array of column keys). The dashboard page now reads the cookie server-side via `next/headers` `cookies()` and passes the validated list as a prop, so SSR and the initial client render emit the user's preferred columns directly. Eliminates the visible flash on every reload where hidden columns briefly appeared before disappearing.
- Hard cutover: existing users' `localStorage` preference is ignored. Anyone who had previously hidden columns will see all columns once on first load, then re-hide via the Columns popover (which now writes the cookie).
- Sidebar `defaultOpen` has the same SSR-read gap and is intentionally deferred to a follow-up — this change is scoped to the Transactions table.

**Sortable columns: single source of truth (Issue #107)**
- Made `SORTABLE_COLUMNS` in `lib/queries/transactions.ts` the single source of truth for the sortable-column whitelist. Added a derived `SORTABLE_COLUMN_KEYS = Object.keys(SORTABLE_COLUMNS) as SortableColumn[]` export and removed the duplicated `VALID_SORT_COLUMNS` array from `dashboard/transactions/page.tsx`.
- Eliminates the silent-bug class where adding a column to `SORTABLE_COLUMNS` but forgetting to update the page's whitelist caused the `?sortBy=` URL param to be dropped on the server with no error — the bug originally hit when adding the Related Account column in #105. Adding a new entry to `SORTABLE_COLUMNS` now makes that column sortable end-to-end with no other file changes; the `SortableColumn` union keeps the runtime whitelist in lockstep automatically.

**Transactions table: stable column widths across sorts**
- Sorting a column previously shifted every column's width because the default `table-layout: auto` re-derives widths from cell content. After a sort the longest visible value in each column changed, so the sort button you'd just clicked physically moved — requiring a mouse reposition to click again for the reverse sort.
- Switched the Transactions table to `table-fixed` and assigned explicit Tailwind width tokens per column (`w-28` for date/type, `w-32` for amount, `w-40` for category, `w-44` for account/related account, `w-80` for description). Added `truncate` on text cells so long values get an ellipsis instead of expanding the column.
- Sort button positions now stay put across sorts and other data changes (pagination, filtering).

### 2026-05-10

**Date Range filter UX fixes (related to Issue #61)**
- Picker now uses a draft-and-commit pattern: calendar clicks and typed input update local state inside the popover, and the URL is only updated when the user clicks **Apply** (or selects a Quick Select preset). Fixes the "popover closes after one click" and "phantom from-date already selected" bugs caused by passing the 30-day default through to the picker as a real selection.
- Manual date input fields are now plain text inputs (`YYYY-MM-DD`) bound to local draft string state, instead of native `<input type="date">` controlled inputs. Typing now works as expected (e.g. `12` in the month no longer snaps to `02`), and clicking the field no longer pops the browser's native date picker on top of the custom calendar.
- Added explicit **Apply** and **Clear** buttons in the popover footer; cancellation (click-outside / Esc) discards the draft.
- Extracted the duplicated `defaultFrom = today − 30 days` block from 8 files into a single shared helper `app/lib/queries/date-range.ts` (`getDateRangeFromParams`). The 30-day default now lives only in the data-fetching layer; the picker UI shows `Last 30 days (default)` as placeholder text in the trigger when no URL params are set.
- No change to Quick Select macros, calendar styling, or the URL-param contract (`?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`). [Issue #61](https://github.com/aellington89/finance-stack/issues/61) (saveable Quick Select presets) remains a follow-up.

### 2026-05-02

**Liabilities drilldown page (Issue #112)**
- New page at `/dashboard/liabilities` mirrors the Assets drilldown structure with sections specific to debt: a 4-card KPI strip (Total / Current / Long-term liabilities, Period Change), liability allocation treemap (category → account type), stacked time-series decomposition by category, dynamic per-account-type Debt Mix tile breakdown, Debt Waterfall (Start → Payments → Interest → Other → End), Debt Service summary (period payments, interest accrued, estimated principal paid + per-account sub-table), and a 3-level expandable Liability Performance table.
- Sign convention: liability balances are kept negative throughout. Display uses the same `signedCurrency` / `changeColor` helpers as the Assets table — `change > 0` (paydown) renders green, `change < 0` (added debt) renders red. The asset-table helpers were extracted to a new shared module `app/lib/format/financial.ts` so both tables stay in lock-step.
- Lookup-driven design: only `account_type_category_id` (5 = Current Liability, 6 = Non-current Liability) is hard-coded in queries. `account_types` are queried dynamically per deployment. The Debt Service queries pin specific `transaction_category_id`s for payments and interest expense in `app/lib/queries/liability-categories.ts` (no name pattern matching, no `transaction_type_id` reference). Test seed and `vitest-setup.ts` extended to include all pinned categories so integration tests cover the full ID set.
- Tests: added `tests/integration/queries/liabilities-drilldown.test.ts` with 13 cases covering all five queries (allocation, performance, decomposition, debt service, waterfall — including pinned-ID coverage and the bridge-reconciliation invariant), plus unit tests for the constants module, debt-mix tile projection, debt-waterfall bar transform, and the performance-table `% Change = "—"` empty-state.
- Sub-nav updated: `SummaryDrilldownTabs` now has Overview / Net Worth / Assets / Liabilities. The new tab uses the existing `DashboardDateRangeFilter` with `basePath="/dashboard/liabilities"`.
- Schema additions deferred to follow-up issue [#110](https://github.com/aellington89/finance-stack/issues/110): APR, credit limit, minimum payment, due date, original principal, term length. Each unlocks specific metrics (weighted APR, credit utilization, payoff timeline, exact principal split, upcoming-payments widget) but none are blocking for v1.
- Lookup-row protection tracked separately as [#109](https://github.com/aellington89/finance-stack/issues/109): the pinned payment/interest `transaction_category_id` rows are user-editable today; deleting one would silently under-report debt-service totals. Closely related to [#87](https://github.com/aellington89/finance-stack/issues/87).

### 2026-05-01 — v0.1.2

**Related Account column on the Transactions table (Issue #105)**
- Added a "Related Account" column to the Transactions list at `/dashboard/transactions`, rendering `related_account_name` from `v_transactions_full`. Most rows are blank — the field is only populated for transfers between accounts.
- Column is sortable (registered in `SORTABLE_COLUMNS` in `lib/queries/transactions.ts` as `relatedAccountName`) and respects the existing localStorage-backed column visibility toggle. Existing users with a saved column preference will need to enable it once via the Columns popover; new users see it by default.
- No schema, migration, query, validation, or form changes — the data was already exposed in the view, the Drizzle schema, and the inline edit row; only the table UI was missing the column.

### 2026-04-19

**Assets drilldown page + liquidity classification (Issue #102)**
- New page at `/dashboard/assets` surfaces asset allocation (treemap by category → account type), period-over-period performance (hierarchical category → type → account table), liquidity breakdown, and a stacked time-series decomposition. Triggered from the Total Assets chart and the Assets-per-$-of-Debt gauge on the Summary tab, or via a new Assets tab in `SummaryDrilldownTabs`.
- New `liquidity_class` column on `account_types` (default, seeded for all asset types) and `accounts` (nullable per-account override). Queries resolve the effective liquidity via `COALESCE(a.liquidity_class, at.liquidity_class)`. Liabilities remain NULL.
- Account creation / edit form gains a Liquidity dropdown with "Inherit from type" default; when a type is selected, the form shows that type's default liquidity as helper text.
- New query module `app/lib/queries/assets-drilldown.ts` mirrors the net-worth drill-down pattern with `getAssetAllocation`, `getAssetPerformance`, `getLiquidityBreakdown`, and `getAssetTrendDecomposition`.
- Performance "return" is proxied by `cumulative_balance` delta (consistent with the net-worth drivers table) — there is no cost-basis schema in v1.
- Fresh installs get the new columns via `init-db/schema.sql`; the `vitest-setup.ts` `ALTER TABLE … ADD COLUMN IF NOT EXISTS` guard covers already-running test DBs so no manual rebuild is needed.
- Added integration tests for all four new queries and three new account-action cases covering the `liquidity_class` override lifecycle; added unit tests for the liquidity-tile projector and the signed-currency/percent/color helpers.

### 2026-04-18

**Editable Transactions table — inline row edit and single-row delete (Issue #99)**
- Each row in the Transactions table now exposes a Pencil and a Trash icon. Pencil flips the row into an inline edit form covering Date, Description, Amount, Account, Related Account, Type, and Category — Save / Cancel buttons commit or discard. Trash opens a confirmation dialog showing the row's date, description, and amount before deletion.
- Added `updateTransaction` and `deleteTransaction` server actions in `lib/actions/transaction.ts`. Both wrap the data change and `rebuildAccountBalance()` calls in a single `db.transaction` for atomicity. Update rebuilds balance history for the union of the old and new `account_id` / `related_account_id`. Delete additionally clears `account_balance_history` for any account that ends up with zero transactions, since the rebuild CTE relies on `MIN(transaction_date)` and would otherwise leave stale rows.
- Added `transaction-edit-row.tsx` and `transaction-delete-dialog.tsx`. Both reuse the `useActionState` + `useFormStatus` + Sonner toast pattern from `entity-dialog.tsx`. The edit row uses a `colSpan` form layout so all editable fields (including Related Account, which has no column) are always present regardless of which columns the user has hidden.
- Validation: both new actions reuse `transactionFormSchema` for full server-side re-validation. Foreign-key violations roll back via the wrapping transaction and surface a generic "Failed to update / delete" message rather than driver text.
- No authentication was added — see new `## Security` section. Tracking issue [#100](https://github.com/aellington89/finance-stack/issues/100) covers the broader security and integrity model design.
- Added 12 new integration tests covering update happy path, account change, transfer reroute, validation rollback, FK rollback, "transaction not found", invalid `transactionId` rejection, delete + balance rebuild, last-transaction cleanup, and transfer delete.

### 2026-04-16

**Make Net Worth KPI and chart obviously clickable (Issue #97)**
- Net Worth headline KPI on the Summary page already linked to the drill-down, but the only affordance was `hover:opacity-80` and most users didn't realise it was clickable. Replaced with a visible `hover:bg-accent` background and a `ChevronRight` icon next to the label that nudges right on hover
- Net Worth time-series chart in "Historical Trends" is now clickable too — the entire card navigates to `/dashboard/net-worth`, with a hover ring + shadow and a chevron in the title
- Added an optional `href` prop to the `TimeSeriesChart` component so future drill-downs (Total Assets, Total Liabilities, gauge KPIs) can be wired up the same way once those pages exist
- Total Assets and Total Liabilities charts are unchanged — left non-clickable on purpose so the affordance stays meaningful (only clickable things look clickable)

### 2026-04-16 — v0.1.1

**Fix past-dated transactions breaking net worth balances (Issue #95)**
- When a transaction was submitted for a past date, the net worth time series showed incorrect values for that date: Total Liabilities dropped to 0 and Total Assets reflected only the account that received the transaction
- Root cause: `rebuildAccountBalance()` only rebuilds history for the affected account(s), and `ensureTodayBalances()` only carried forward balances for today — leaving other accounts with no balance rows for intermediate dates
- Rewrote `ensureTodayBalances()` in `lib/queries/rebuild-balance.ts` to fill ALL missing gap dates (from each account's last balance row through today) using `CROSS JOIN LATERAL` + `generate_series`, instead of only filling today. Uses `ON CONFLICT DO NOTHING` so rows already created by `rebuildAccountBalance()` are never overwritten
- Added integration tests for gap-filling behavior and non-overwrite of existing intermediate rows

### 2026-04-14

**Net Worth drill-down: nested drivers and By Account Type decomposition**
- Net Worth Drivers table is now a 3-level expandable hierarchy: account type category → account type → account. Rows expand in place with chevron toggles and preserve scroll position across expands/collapses
- Replaced the single `% Impact` column with `% of Parent` and `% of Total` so users can see both the local contribution at each level and the share of total net worth change
- `getNetWorthDrivers()` rewritten to aggregate directly from `account_balance_history` in a single query (previously derived from the waterfall result), returning the full nested `DriverCategory → DriverAccountType → DriverAccount` shape
- `getNetWorthTrendDecomposition()` now returns `accountTypeId` and `accountTypeName` on each point so the chart can pivot at the account-type level
- Time Series chart: added a "By Account Type" mode alongside Net Worth / By Category / By Account, and added Select All / Clear All shortcuts to the clickable legend
- Drill-down page layout: Drivers table is now full-width; Time Series and Waterfall sit side-by-side at a fixed height. Waterfall tooltip no longer double-lists the value row
- Integration tests updated to assert the nested drivers shape, that child changes sum to parent change at every level, that category `% of Total` sums to ~100, and that decomposition points expose the new account-type fields

### 2026-04-12

**Net Worth drill-down page**
- Added `/dashboard/net-worth` drill-down page accessible by clicking the Net Worth KPI on the Summary page
- New visuals: Waterfall Analysis (what changed net worth over a period), Net Worth Drivers table (per-category change and % impact), and Trend Decomposition chart (multi-series line chart by account type category or individual account, with toggleable views)
- Reuses existing Net Worth headline and Net Worth over time line chart from the Summary page
- Added `SummaryDrilldownTabs` sub-navigation component with "Overview" and "Net Worth" tabs, designed for future Summary drill-down pages (e.g. Assets, Liabilities)
- New query functions in `lib/queries/net-worth-drilldown.ts`: `getNetWorthWaterfall()`, `getNetWorthDrivers()`, `getNetWorthTrendDecomposition()`
- Integration tests for all three query functions; unit tests for the waterfall data transformation logic

### 2026-04-11

**Sync shared lookups and auto-seed Finances_Test mock data on first launch (PR #88)**
- `init-db/01-create-databases.sh` now seeds the shared lookup tables (`account_type_categories`, `transaction_types`) into both `Finances` and `Finances_Test` on first launch, so the two databases start in sync. Existing `Finances` user data is protected by three independent safeguards: the init directory only runs on an empty data volume, a pre-flight row-count check skips the insert if `Finances.accounts`/`Finances.transactions` is non-empty, and the SQL itself uses `ON CONFLICT DO NOTHING`.
- `Finances_Test` is now fully populated on first launch with 19 `account_types`, 27 `transaction_categories`, 8 accounts, and 424 deterministic transactions spanning the past 12 months. All dates are generated via `CURRENT_DATE - INTERVAL` math at seed time, so the mock data is always current relative to when the process runs. `account_balance_history` is rebuilt as the final init step.
- New seed files live under `init-db/seeds/`: `shared-lookups.sql`, `finances-test-mock-data.sql`, and `rebuild-balance-history.sql`. The mock-data seed is idempotent — re-runs short-circuit inside a `DO $$` block if transactions already exist.
- `.github/workflows/ci.yml` updated to run the three seed files after applying `schema.sql`, so CI integration tests hit the same baseline as a fresh local install.
- Deleted the now-redundant `scripts/seed-test-data.sql` (previously had to be run manually with hardcoded 2024-era dates).
- Rewrote the Test Database and balance-history sections of this README, added a first-launch walkthrough, and documented the resync procedure for when mock data ages out or the schema changes.

### 2026-04-10 — Hotfix

**Align integration test DB with production lookup values (Issue #87)**
- The `beforeAll` in `app/tests/integration/vitest-setup.ts` previously truncated the static lookup tables and re-inserted a tiny non-production subset (`account_type_categories` had only `Asset`; `transaction_types` had only `Expense` and `Opening Balance`). A recent edit that removed `CASCADE` also left the truncates in a broken state because `account_types → account_type_categories` and `transactions → transaction_types` / `transaction_categories` foreign keys block non-CASCADE truncation.
- Rewrote the setup to idempotently upsert the full production row sets — all 6 `account_type_categories` and all 12 `transaction_types` — using `INSERT ... OVERRIDING SYSTEM VALUE ... ON CONFLICT DO UPDATE`. Identity sequences are advanced to `MAX(id)` after seeding so auto-generated inserts do not collide.
- Keeps the test DB's static lookup values identical to the `Finances` database so tests exercise realistic KPI-driving data. No test source files needed changes — the Zod schemas only validate IDs as positive integers.
- Opened [#87](https://github.com/aellington89/finance-stack/issues/87) to track locking these two tables down from user-level editing in the app UI, since they drive core KPIs and should only be mutable by a (future) sys-admin activity.

### 2026-04-10

**Persist Date, Account, and Transaction Type on transaction form submit (Issue #67)**
- After a successful transaction submit, the Date, Account, and Transaction Type fields now retain their values so users can enter runs of related transactions (e.g. reconciling a statement) without re-selecting them each time
- Description, Amount, Related Account, and Category continue to reset to empty after a successful submit
- Extracted the post-submit reset decision into a pure helper at `lib/forms/transaction.ts` (`getPostSubmitState`) and covered it with unit tests in `tests/unit/lib/forms/transaction.test.ts`

### 2026-04-07

**Add importer Docker service for file ingestion (Issue #84)**
- Added `importer` service to `docker-compose.yml`: always-on Python container that polls `imports/` subdirectories every 60 seconds for new files
- Subfolder-based routing: each subdirectory under `imports/` maps to a parser module in `importer/parsers/` (e.g., `imports/paystubs/` → `parsers/paystubs.py`)
- Connects to Postgres over the shared `appnet` network using `DATABASE_URL`
- Loads PK lookup maps from `accounts`, `transaction_categories`, and `transaction_category_types` on startup
- Fails loudly on unmatched fields — no silent skips or null placeholders
- `importer/poll.py` dispatcher is committed; `importer/parsers/` is gitignored (user-specific)
- Created `imports/` drop folder structure and added `imports/` and `importer/parsers/` to `.gitignore`

### 2026-03-29

**Fix dashboard showing incorrect balances (Issue #68)**
- Added `ensureTodayBalances()` carry-forward function in `lib/queries/rebuild-balance.ts`: on each dashboard load, inserts a today row for every open account (carrying forward the most recent cumulative balance) if one doesn't already exist
- Called from `app/(app)/dashboard/layout.tsx` as an async server component — runs on every dashboard page load but is a no-op after the first call of the day
- Added integration tests for the new function covering carry-forward, idempotency, closed-account exclusion, and coexistence with `rebuildAccountBalance()`

**Codebase hardening (Issue #79)**
- Fixed SQL injection vulnerability in `accounting.ts` and `work-expenses.ts`: date inputs from URL params were interpolated directly into `sql.raw()`. Added `safeDate()` validation (`/^\d{4}-\d{2}-\d{2}$/`) and switched all user-controlled filter values (descriptions, accountIds, categoryIds) from manual string interpolation to Drizzle parameterized queries
- Added `app/(app)/error.tsx` error boundary so unhandled database or runtime errors show a user-friendly retry UI instead of the default Next.js error page
- Added `.refine()` to `transactionFormSchema` preventing self-referential transactions (`accountId === relatedAccountId`)
- Added Vitest test suite: unit tests for all Zod validation schemas and utility functions; integration tests for account and transaction server actions against `Finances_Test`
- Added GitHub Actions CI workflow (lint + unit tests + integration tests on push/PR)
- Extracted shared `ActionState` type and `buildFieldErrors()` helper from action files into `lib/actions/utils.ts`
- Added explanatory comments to non-obvious logic: magic constants in `actions/account.ts`, HMR pool pattern in `lib/db/index.ts`, SQL ROLLUP in `queries/accounts.ts`
- Gated `/test-ui` page to development-only (returns 404 in production builds)
- Updated `.gitignore` and `.dockerignore` to exclude test output and CI config from Docker builds

### 2026-03-29 — v0.1.0

**Unified sidebar navigation (Issue #77)**
- Added a persistent sidebar navigation using shadcn's Sidebar component, connecting all application sections
- Sidebar items: Dashboard, Accounts, Settings — with active state detection via `usePathname()`
- Used Next.js route groups to split the app: `(landing)/` for the home page (no sidebar), `(app)/` for all application pages (with sidebar)
- Created `components/app-sidebar.tsx` (client component) and `app/(app)/layout.tsx` (app shell with `SidebarProvider` + `SidebarInset`)
- Mobile responsive out-of-the-box: sidebar collapses to a sheet overlay on small screens via shadcn's `useMobile` hook
- Installed shadcn sidebar, separator, sheet, tooltip, and skeleton components
- Removed redundant `<h1>Dashboard</h1>` from dashboard layout; changed nested `<main>` tags to `<div>` across accounts and settings pages
- Sidebar respects light/dark theme via existing `--sidebar-*` CSS variables in `globals.css`

## Development History

[v0.1.0-alpha.1 - v0.1.0-alpha.5](https://github.com/aellington89/finance-stack/wiki/Alpha-Development-History)
