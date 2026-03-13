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
- [Node.js 20+](https://nodejs.org/) (for the Next.js application)

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
│   │   ├── layout.tsx                    # Root layout
│   │   ├── page.tsx                      # Landing page (/)
│   │   ├── dashboard/                    # Tabbed dashboard with 5 tabs:
│   │   │   ├── layout.tsx                #   Layout with tab navigation
│   │   │   ├── page.tsx                  #   Summary tab (/)
│   │   │   ├── accounting/               #   Personal Accounting tab
│   │   │   ├── transactions/             #   Transactions tab (form + list)
│   │   │   ├── accounts/                 #   Accounts tab (balance pivot table)
│   │   │   └── work-expenses/            #   Work Expenses tab
│   │   ├── transactions/                 # /transactions, /transactions/new
│   │   ├── accounts/                     # /accounts, /accounts/new
│   │   ├── settings/categories/          # /settings/categories
│   │   └── test-ui/                      # /test-ui — UI component verification page
│   ├── components.json                   # shadcn/ui configuration
│   ├── drizzle/                          # Drizzle ORM (generated)
│   │   ├── schema.ts                     # Table definitions (generated by drizzle-kit pull)
│   │   └── relations.ts                  # Table relations (generated by drizzle-kit pull)
│   ├── components/
│   │   ├── ui/                           # shadcn/ui components (Button, Card, Table, Dialog, etc.)
│   │   │   └── date-range-picker.tsx     # Date range picker with quick select + manual input
│   │   └── transactions/                 # Transaction-specific components
│   │       ├── transaction-form.tsx      # Transaction entry form (client component)
│   │       ├── transaction-list.tsx      # Sortable transaction table (client component)
│   │       └── transaction-filters.tsx   # Filter bar with date range, multi-select, amount
│   └── lib/                              # Shared libraries
│       ├── db/index.ts                   # Drizzle ORM client (PostgreSQL connection)
│       ├── actions/transaction.ts        # Server action for transaction submission
│       ├── queries/rebuild-balance.ts    # Per-account balance history rebuild
│       ├── queries/transactions.ts       # Transaction queries (filtered, sorted, form options)
│       ├── validations/transaction.ts    # Zod schema for transaction form validation
│       └── utils.ts                      # Utility helpers (cn() class merge)
├── init-db/
│   ├── 01-create-databases.sh            # First-run DB/role creation (auto-runs on empty data dir)
│   └── schema.sql                        # Tables, indexes, and views (applied to Finances and Finances_Test)
└── scripts/
    ├── UpdateAccountBalanceHistory.sql    # Balance history rebuild script
    └── seed-test-data.sql                # Sample data for Finances_Test
```

## Stopping the Stack

```bash
docker compose down
```

Data is persisted in Docker volumes and will be available on next startup.

## Updates

### 2026-03-13

**Appsmith removal (Issue #37)**
- Removed Appsmith service from stack (~3GB memory saved)

### 2026-03-12

**Side-by-side layout redesign (Issue #60)**
- Transaction form moved to a compact sidebar widget (~1/3 width) on the right
- Filters + transaction table take ~2/3 on the left
- Form uses single-column layout with Date+Amount and Type+Category in 2-col grids
- Responsive: stacks vertically below `lg` breakpoint

**Date Range Picker with Quick Select (Issue #60)**
- Replaced two separate DatePicker filters with a single `DateRangePicker` component
- Quick Select builder: compose a range from Last/This + number + Days/Weeks/Months/Years
- Two-month range calendar for custom date selection
- Manual date input fields below the calendar for typing dates directly
- Created reusable `DateRangePicker` component at `components/ui/date-range-picker.tsx`

**Sortable table columns (Issue #60)**
- All 6 table columns are sortable: Date, Description, Amount, Account, Type, Category
- Server-side sorting via `sortBy` and `sortDir` URL search params with dynamic Drizzle ORDER BY
- Click header to sort ascending; click again to toggle descending
- Sort indicator arrows on active column; neutral icon on inactive columns

**Filter alignment fix (Issue #60)**
- Added `FilterSlot` wrapper component for consistent label + control vertical alignment
- Consolidated date filters from two slots to one, freeing horizontal space

### 2026-03-11

**Add filters to transaction list (Issue #60)**
- Added server-side filtering to the Transactions tab via URL search params
- Filter controls: date range (from/to DatePickers), description (multi-select searchable Combobox), amount (text input), account/type/category (multi-select searchable Combobox with chips)
- Filters query the full transaction history with dynamic WHERE clauses via Drizzle ORM
- Added `getFilteredTransactions()` and `getUniqueDescriptions()` to `lib/queries/transactions.ts`
- Created `TransactionFilters` client component using existing Combobox multi-select with chips
- Filters are bookmarkable via URL search params (e.g. `?dateFrom=2026-01-01&accountIds=1,3`)
- "Clear All" button resets all filters; empty state distinguishes filtered vs unfiltered

**Integrate transaction form and list as dashboard tab (Issue #60)**
- Redesigned dashboard with 5 URL-based tabs: Summary, Personal Accounting, Transactions, Accounts, Work Expenses
- Transactions tab integrates the entry form with a recent transactions list on a single page
- Transaction list auto-refreshes after form submission via `revalidatePath`
- Extracted shared query functions to `lib/queries/transactions.ts` (`getTransactionFormOptions`, `getRecentTransactions`)
- Moved `TransactionForm` to `components/transactions/transaction-form.tsx` for reuse across routes
- Moved server action to `lib/actions/transaction.ts` for shared access
- Created `TransactionList` component using shadcn Table with currency formatting
- Tab navigation uses `usePathname` + `useRouter` synced to sub-routes
- `/transactions/new` page still works independently via re-exports

### 2026-03-08

**Build transaction entry form page (Issue #26)**
- Created `/transactions/new` page with transaction entry form replacing Appsmith's Transaction Entry page
- Form fields: description, date picker, currency amount, searchable account/related account/type/category dropdowns
- Installed shadcn/ui Combobox component (searchable select using `@base-ui/react` Combobox primitive)
- Created reusable DatePicker component (Popover + Calendar composition)
- Created reusable CurrencyInput component with `$` prefix and format-on-blur
- Added Zod validation schema at `lib/validations/transaction.ts`
- Added stub Server Action with validation (wired up in Issue #27)
- Installed sonner for toast notifications; added `<Toaster />` to root layout
- Server Component page fetches accounts, types, and categories via Drizzle and passes to client form

**Implement Server Action for transaction insertion (Issue #27)**
- Replaced stub Server Action with actual Drizzle insert wrapped in a Postgres transaction
- Validates form data via Zod, inserts into `transactions` table, then rebuilds balance history
- Calls `revalidatePath()` for `/dashboard` and `/accounts` after successful insert
- Returns field-level validation errors or generic DB error message on failure
- Disabled browser autocomplete on description and amount fields

**Implement per-account balance history rebuild (Issue #28)**
- Created `lib/queries/rebuild-balance.ts` — scoped version of `UpdateAccountBalanceHistory.sql`
- Rebuilds balance history for a single account (~400 rows, <100ms) instead of all accounts (~15K rows)
- Uses parameterized raw SQL via Drizzle's `sql` template tag (same CTE logic as the full rebuild)
- Auto-triggers inside the Server Action after transaction insert; also rebuilds the related account if present
- Full rebuild script preserved in `scripts/` for bulk operations

**Move Metabase behind Docker Compose profile (Issue #25)**
- Added `profiles: ["bi"]` to the Metabase service so it no longer starts by default
- Saves ~2GB RAM during normal operation
- Start Metabase on demand: `docker compose --profile bi up metabase -d`
- Existing dashboards, metrics, and models preserved in `metabase_data` volume

**Create v_daily_totals database view (Issue #24)**
- Created `v_daily_totals` view returning daily transaction totals grouped by transaction type
- View serves as the data source for income/expense/investment line charts on the Personal Accounting page
- Applied to both `Finances` and `Finances_Test` databases
- Added view definition to `init-db/schema.sql` for fresh installs
- Regenerated Drizzle ORM schema to include typed `pgView` definition

**Create v_account_balances_current database view (Issue #23)**
- Created `v_account_balances_current` view returning the latest cumulative balance per account with account type and category hierarchy
- View serves as the data source for the accounts balance table page
- Applied to both `Finances` and `Finances_Test` databases
- Added view definition to `init-db/schema.sql` for fresh installs
- Added typed `pgView` definition to Drizzle ORM schema

**Create v_transactions_full database view (Issue #22)**
- Created `v_transactions_full` view joining transactions with accounts, account types, account type categories, transaction types, transaction categories, and related accounts
- View serves as the primary data source for the transaction list, filters, and aggregations
- Applied to both `Finances` and `Finances_Test` databases
- Added view definition to `init-db/schema.sql` for fresh installs
- Regenerated Drizzle ORM schema to include typed `pgView` definition

### 2026-03-07

**Add database indexes for query performance (Issue #21)**
- Added secondary indexes on `transactions` table: `transaction_date`, `(account_id, transaction_date)`, `transaction_category_id`, `transaction_type_id`
- Added index on `account_balance_history.balance_date` for cross-account date-range queries
- Indexes included in `init-db/schema.sql` for fresh installs

### 2026-03-06

**Install and configure shadcn/ui with charting libraries (Issue #20)**
- Initialized shadcn/ui (base-nova style, neutral base color, CSS variables)
- Installed base components: Button, Input, Select, Card, Table, Calendar, Popover, Dialog, Tabs, Badge, Label
- Installed shadcn/ui Charts (Recharts-based) for line, bar, and area charts
- Installed `react-chartjs-2` and `chart.js` for gauge/doughnut charts
- Installed `@tanstack/react-table` for sortable/filterable data tables
- Implemented `cn()` class merge utility in `lib/utils.ts`
- Created `/test-ui` verification page demoing all four libraries

**Set up Drizzle ORM with PostgreSQL connection (Issue #19)**
- Installed `drizzle-orm`, `pg`, `drizzle-kit`, and `@types/pg`
- Ran `drizzle-kit pull` to introspect the Finances database — generated typed schema for all 7 tables with relations
- Created `app/drizzle.config.ts` for Drizzle Kit configuration
- Implemented database connection in `app/lib/db/index.ts` with global Pool singleton (prevents hot-reload leaks)
- Enhanced `/api/health` endpoint with a DB connectivity check (`SELECT 1`)
- Added npm scripts: `db:pull`, `db:generate`, `db:migrate`

**Dockerize Next.js application (Issue #18)**
- Created `app/Dockerfile` with multi-stage build (deps, build, runner) on `node:22-alpine`
- Added `finance-app` service to `docker-compose.yml` (port 3001, 512M memory, 0.5 CPU)
- App connects to PostgreSQL via `DATABASE_URL` composed from existing `.env` credentials
- Health check via `GET /api/health` with `wget` (no curl install needed)
- Added `app/.dockerignore` to keep build context lean

### 2026-03-05

**Next.js application scaffold (Issue #17)**
- Initialized Next.js 16 project in `app/` subdirectory with TypeScript, Tailwind CSS v4, and App Router
- Configured `output: 'standalone'` in `next.config.ts` for future Docker deployment (Issue #18)
- Created placeholder routes: `/dashboard`, `/dashboard/accounting`, `/dashboard/work-expenses`, `/transactions`, `/transactions/new`, `/accounts`, `/accounts/new`, `/settings/categories`
- Added stub directories for Drizzle ORM (`lib/db/`) and shadcn/ui (`components/ui/`)
- Added `.env.local.example` template for database connection
- Dev server runs on port 3001 to avoid conflict with Metabase (port 3000)

### 2026-03-01

**Test database and version-controlled schema**
- Added `Finances_Test` database for development and testing (same schema, sample data)
- Added `init-db/schema.sql` — version-controlled schema DDL extracted from production via `pg_dump`
- Added `scripts/seed-test-data.sql` — sample accounts and transactions for the test database
- Updated `init-db/01-create-databases.sh` to create both `Finances` and `Finances_Test` and apply schema on first start

### 2025-02-27

**Critical Bug Fix - PostgreSQL 18 volume path fix**
Changed the Postgres volume mount from `/var/lib/postgresql/data` to `/var/lib/postgresql` to match PG18's updated `PGDATA` directory.

**Tier 1 — Security and reliability hardening**
- Extracted all credentials to `.env` (see `.env.example` for the template)
- Added `restart: unless-stopped` to long-running services
- Metabase and Appsmith now wait for Postgres to be healthy before starting
- Pinned all image tags: `postgres:18.0`, `metabase:v0.58.8`, `appsmith-ee:v1.87`

**Tier 2 — Operational improvements**
- Added healthchecks for Metabase and Appsmith so `docker compose ps` reports accurate status
- Added log rotation (30 MB max per service) to prevent disk fills
- Added `init-db/01-create-databases.sh` so the stack self-initializes on a fresh clone
- Added memory and CPU resource limits to all services

**Tier 3 — Developer experience**
- Init-script moved behind `profiles: ["init"]` — no longer runs on every `docker compose up`
- Hardened init-script entrypoint with `set -euo pipefail`, retry loop, and read-only script mount
- Added `name: finance-stack` for consistent container/volume naming
- Added labels to all services for filtering with `docker ps --filter`
- Created `.dockerignore`
