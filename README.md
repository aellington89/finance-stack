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
2. Build and start the Next.js finance application
3. Start the importer service

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

On the first `docker compose up` (empty Postgres data volume), [`init-db/01-create-databases.sh`](init-db/01-create-databases.sh) runs automatically and:

1. Creates both the `Finances` and `Finances_Test` databases (plus the Metabase database).
2. Applies [`init-db/schema.sql`](init-db/schema.sql) to each.
3. Seeds the two **shared lookup tables** (`account_type_categories`, `transaction_types`) into both databases so they start in sync. The Finances side uses `ON CONFLICT DO NOTHING` and is additionally guarded by a pre-flight row-count check — **existing Finances user data is never overwritten**, even on a manual re-run.
4. Seeds `Finances_Test` with mock data: all 19 `account_types`, all 27 `transaction_categories`, 8 accounts, and ~400 transactions spanning the past 12 months relative to `CURRENT_DATE` at seed time.
5. Rebuilds `Finances_Test.account_balance_history` so balances are up-to-date as of today.

After this completes, `Finances` contains only the shared lookups and is ready for the user (or the importer) to populate via normal application use. `Finances_Test` contains a full year of mock activity usable by integration tests and for UI development.

## Test Database

`Finances_Test` is populated automatically on first launch — no manual seeding is required. The seed artifacts live in [`init-db/seeds/`](init-db/seeds/):

| File | Purpose |
|---|---|
| `shared-lookups.sql` | 6 account type categories + 12 transaction types (runs against both DBs) |
| `finances-test-mock-data.sql` | 19 account types, 27 categories, 8 accounts, ~400 transactions with dates derived from `CURRENT_DATE` |
| `rebuild-balance-history.sql` | Mirrors `scripts/UpdateAccountBalanceHistory.sql`, runs against `Finances_Test` at seed time |

### Refreshing Finances_Test (dates age out, or schema changed)

The mock transaction dates are evaluated once, at seed time. If they drift out of the "past 12 months" window, or the schema changes, drop and re-seed the test database:

```bash
# 1. (Only if schema changed) re-extract it from the Finances DB
docker exec postgres pg_dump -U postgres -d Finances --schema-only --no-owner --no-privileges > init-db/schema.sql

# 2. Drop and recreate Finances_Test
docker exec postgres psql -U postgres -c 'DROP DATABASE IF EXISTS "Finances_Test";'
docker exec postgres psql -U postgres -c 'CREATE DATABASE "Finances_Test";'

# 3. Re-apply schema and seeds
docker exec -i postgres psql -U postgres -d Finances_Test < init-db/schema.sql
docker exec -i postgres psql -U postgres -d Finances_Test < init-db/seeds/shared-lookups.sql
docker exec -i postgres psql -U postgres -d Finances_Test < init-db/seeds/finances-test-mock-data.sql
docker exec -i postgres psql -U postgres -d Finances_Test < init-db/seeds/rebuild-balance-history.sql
```

Commit `init-db/schema.sql` after any schema change so fresh installs get the latest version.

### Static lookup tables in integration tests

The integration test `beforeAll` (in [`app/tests/integration/vitest-setup.ts`](app/tests/integration/vitest-setup.ts)) upserts the full production row set for `account_type_categories` (6 rows) and `transaction_types` (12 rows) before any test runs. This is a drift-correction safety net — the seed files above already populate these tables on first launch. No manual seed step is required.

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
│   │       ├── dashboard/                #   Tabbed dashboard with 5 tabs + drill-downs:
│   │       │   ├── layout.tsx            #     Layout with tab navigation
│   │       │   ├── page.tsx              #     Summary tab (/)
│   │       │   ├── net-worth/            #     Net Worth drill-down (from Summary KPI click)
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
│   │   │   ├── waterfall-chart.tsx       # Net worth waterfall analysis chart (Recharts)
│   │   │   ├── trend-decomposition-chart.tsx # Multi-series trend decomposition by category/account (Recharts)
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
│   │   │   ├── date-range-filter.tsx     # URL-param-driven date range filter wrapper
│   │   │   ├── net-worth-drivers-table.tsx # Expandable net worth drivers table (category → account type → account)
│   │   │   └── summary-drilldown-tabs.tsx # Sub-navigation tabs for Summary drill-down pages
│   │   └── transactions/                 # Transaction-specific components
│   │       ├── transaction-form.tsx      # Transaction entry form (client component)
│   │       ├── transaction-list.tsx      # Sortable transaction table with inline edit + delete (client component)
│   │       ├── transaction-edit-row.tsx  # Inline row-edit form (client component, uses updateTransaction action)
│   │       ├── transaction-delete-dialog.tsx # Delete confirmation modal (uses deleteTransaction action)
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
│       ├── queries/net-worth-drilldown.ts # Net worth drill-down queries (waterfall, drivers, decomposition)
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
├── importer/                              # File import service
│   ├── poll.py                            # Polling loop and parser dispatcher (committed)
│   └── parsers/                           # One module per import type (gitignored)
├── imports/                               # Drop folders — one per import type (gitignored)
├── .github/workflows/ci.yml             # CI: lint + unit tests + integration tests on push/PR
├── init-db/
│   ├── 01-create-databases.sh            # First-run DB/role creation + seed orchestration (auto-runs on empty data dir)
│   ├── schema.sql                        # Tables, indexes, and views (applied to Finances and Finances_Test)
│   └── seeds/
│       ├── shared-lookups.sql            # account_type_categories + transaction_types (both DBs)
│       ├── finances-test-mock-data.sql   # account_types, transaction_categories, accounts, ~400 txns (Finances_Test only)
│       └── rebuild-balance-history.sql   # Balance history rebuild for Finances_Test post-seed
└── scripts/
    └── UpdateAccountBalanceHistory.sql   # Balance history rebuild script (manual / --profile init)
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

### 2026-04-18 — v0.1.2 (in progress)

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
