# Finance Stack

A containerized personal finance data warehouse for aggregating, storing, and visualizing multi-account financial data.

## Stack

| Service | Description | Local Port |
|---|---|---|
| PostgreSQL 18 | Primary database | 5433 |
| Next.js 16 | Custom finance application | 3001 |
| Metabase | BI dashboards and analytics (`--profile bi`) | 3000 |

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
2. Build and start the Next.js finance application

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

`account_balance_history` stores daily cumulative balances for each account, filling in days with no transactions with a zero daily change. The init-script that rebuilds it is behind a profile and does not run automatically. To run it:

```bash
docker compose --profile init run --rm init-script
```

## Test Database

A `Finances_Test` database is available for development and testing. It has the same schema as the production `Finances` database but contains sample data.

### Fresh installation (automatic)

On a fresh clone with no existing Postgres data volume, `Finances_Test` is created automatically when you run `docker compose up` for the first time. To seed it with test data:

```bash
docker exec -i postgres psql -U postgres -d Finances_Test < scripts/seed-test-data.sql
```

Then rebuild balance history for the test data:

```bash
docker compose --profile init run --rm -e PGDATABASE=Finances_Test init-script
```

### Existing installation (manual setup)

If you already have a running stack and want to add the test database:

```bash
# Create the database
docker exec postgres psql -U postgres -c 'CREATE DATABASE "Finances_Test";'

# Apply the schema
docker exec -i postgres psql -U postgres -d Finances_Test < init-db/schema.sql

# Seed with test data
docker exec -i postgres psql -U postgres -d Finances_Test < scripts/seed-test-data.sql

# Build balance history
docker compose --profile init run --rm -e PGDATABASE=Finances_Test init-script
```

### Running balance history against test data

Override the target database inline (no `.env` change needed):

```bash
docker compose --profile init run --rm -e PGDATABASE=Finances_Test init-script
```

Or set `INIT_SCRIPT_DB=Finances_Test` in `.env` and run normally:

```bash
docker compose --profile init run --rm init-script
```

### Schema changes

When you modify the production schema (add tables, columns, etc.), re-sync the test database:

```bash
# 1. Re-extract the schema from production
docker exec postgres pg_dump -U postgres -d Finances --schema-only --no-owner --no-privileges > init-db/schema.sql

# 2. Drop and recreate the test database
docker exec postgres psql -U postgres -c 'DROP DATABASE IF EXISTS "Finances_Test";'
docker exec postgres psql -U postgres -c 'CREATE DATABASE "Finances_Test";'
docker exec -i postgres psql -U postgres -d Finances_Test < init-db/schema.sql
docker exec -i postgres psql -U postgres -d Finances_Test < scripts/seed-test-data.sql
docker compose --profile init run --rm -e PGDATABASE=Finances_Test init-script
```

Commit the updated `init-db/schema.sql` so fresh installs get the latest schema.

## Project Structure

```
finance-stack/
├── docker-compose.yml                    # Infrastructure definition
├── .env.example                          # Template for credentials (copy to .env)
├── .dockerignore                         # Excludes files from Docker build context
├── app/                                  # Next.js 16 application (App Router)
│   ├── Dockerfile                        # Multi-stage Docker build (deps → build → runner)
│   ├── .dockerignore                     # Excludes node_modules, .next, etc. from build context
│   ├── package.json                      # Node.js dependencies and scripts
│   ├── next.config.ts                    # Next.js config (standalone output for Docker)
│   ├── .env.local.example                # Template for app env vars (copy to .env.local)
│   ├── app/                              # App Router — pages and layouts
│   │   ├── api/health/route.ts           # Health check endpoint for Docker
│   │   ├── layout.tsx                    # Root layout (fonts, ThemeProvider, Toaster)
│   │   ├── (landing)/                    # Route group — no sidebar
│   │   │   └── page.tsx                  #   Landing page (/)
│   │   └── (app)/                        # Route group — sidebar navigation shell
│   │       ├── layout.tsx                #   App shell (SidebarProvider + AppSidebar + SidebarInset)
│   │       ├── error.tsx                 #   Error boundary — catches unhandled errors with retry UI
│   │       ├── dashboard/                #   Tabbed dashboard with 5 tabs:
│   │       │   ├── layout.tsx            #     Layout with tab navigation
│   │       │   ├── page.tsx              #     Summary tab (/)
│   │       │   ├── accounting/           #     Personal Accounting tab
│   │       │   ├── transactions/         #     Transactions tab (form + list)
│   │       │   ├── accounts/             #     Accounts tab (visual balance sheet)
│   │       │   └── work-expenses/        #     Work Expenses tab
│   │       ├── accounts/                 #   /accounts, /accounts/new, /accounts/[id]/edit
│   │       ├── settings/categories/      #   /settings/categories — CRUD for all reference-data tables
│   │       └── test-ui/                  #   /test-ui — UI component verification page
│   ├── components.json                   # shadcn/ui configuration
│   ├── drizzle/                          # Drizzle ORM (generated)
│   │   ├── schema.ts                     # Table definitions (generated by drizzle-kit pull)
│   │   └── relations.ts                  # Table relations (generated by drizzle-kit pull)
│   ├── hooks/
│   │   └── use-mobile.ts                 # Mobile breakpoint detection hook (used by sidebar)
│   ├── components/
│   │   ├── app-sidebar.tsx               # Global sidebar navigation (Dashboard, Accounts, Settings)
│   │   ├── ui/                           # shadcn/ui components (Button, Card, Table, Dialog, Sidebar, etc.)
│   │   │   └── date-range-picker.tsx     # Date range picker with quick select + manual input
│   │   ├── charts/                       # Chart components (client components)
│   │   │   ├── accounting-chart.tsx      # Time-series area chart for income/expenses/investments (Chart.js)
│   │   │   ├── expenses-category-chart.tsx # Donut chart for expense category breakdown (Chart.js)
│   │   │   ├── work-expenses-chart.tsx   # Grouped bar chart for work expenses vs reimbursements over time
│   │   │   ├── net-worth-chart.tsx       # Reusable time-series line chart (Recharts)
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
│   │   │   ├── accounting-filters.tsx    # Multi-select combobox filters for accounting page
│   │   │   ├── accounting-kpi-card.tsx   # KPI card with change indicator for accounting metrics
│   │   │   └── date-range-filter.tsx     # URL-param-driven date range filter wrapper
│   │   └── transactions/                 # Transaction-specific components
│   │       ├── transaction-form.tsx      # Transaction entry form (client component)
│   │       ├── transaction-list.tsx      # Sortable transaction table (client component)
│   │       └── transaction-filters.tsx   # Filter bar with date range, multi-select, amount
│   └── lib/                              # Shared libraries
│       ├── db/index.ts                   # Drizzle ORM client (PostgreSQL connection)
│       ├── actions/utils.ts              # Shared ActionState type and buildFieldErrors() helper
│       ├── actions/transaction.ts        # Server action for transaction submission
│       ├── actions/account.ts           # Server actions for account create, update, delete
│       ├── queries/accounts.ts           # Account balance queries (ROLLUP aggregation)
│       ├── queries/accounting.ts         # Accounting queries (time series, period totals, category breakdown, averages)
│       ├── queries/work-expenses.ts     # Work expense queries (period totals, time series, category breakdown)
│       ├── queries/dashboard.ts          # Dashboard queries (net worth, time series)
│       ├── queries/rebuild-balance.ts    # Per-account balance history rebuild
│       ├── queries/transactions.ts       # Transaction queries (filtered, sorted, form options)
│       ├── validations/transaction.ts    # Zod schema for transaction form validation
│       ├── validations/account.ts       # Zod schema for account form validation
│       ├── actions/categories.ts        # Server actions for category/type create, update, delete
│       ├── queries/categories.ts        # Queries for all four reference-data tables
│       ├── validations/categories.ts    # Zod schemas for category/type forms
│       └── utils.ts                      # Utility helpers (cn() class merge)
│   ├── tests/                            # Vitest test suite
│   │   ├── unit/                         # Unit tests (no DB required)
│   │   │   ├── validations/              #   Zod schema tests (account, transaction, categories)
│   │   │   ├── actions/                  #   Action utility tests (buildFieldErrors)
│   │   │   └── lib/                      #   Library utility tests (cn, formatters)
│   │   └── integration/                  # Integration tests (requires Finances_Test DB)
│   │       ├── setup.ts                  #   Global setup — asserts test DB URL
│   │       ├── vitest-setup.ts           #   Per-test setup/teardown
│   │       ├── actions/                  #   Server action tests (account, transaction)
│   │       └── queries/                  #   Query function tests (rebuild-balance)
│   └── vitest.config.ts                  # Vitest configuration (unit + integration projects)
├── .github/workflows/ci.yml             # CI: lint + unit tests + integration tests on push/PR
├── init-db/
│   ├── 01-create-databases.sh            # First-run DB/role creation (auto-runs on empty data dir)
│   └── schema.sql                        # Tables, indexes, and views (applied to Finances and Finances_Test)
└── scripts/
    ├── UpdateAccountBalanceHistory.sql    # Balance history rebuild script
    └── seed-test-data.sql                # Sample data for Finances_Test
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

### 2026-03-29 — v0.1.1

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
