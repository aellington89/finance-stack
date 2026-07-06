# Database

Covers the schema, views, balance-history table, first-launch initialization, and the test database.

## Schema

| Table | Description |
|---|---|
| `accounts` | All financial accounts (checking, savings, credit cards, loans, etc.) |
| `account_type_categories` | Top-level account categories (e.g. Current Asset, Current Liability) |
| `account_types` | Specific account types (e.g. Checking, Mortgage, Credit Card) |
| `transactions` | Individual financial transactions |
| `transaction_categories` | Expense/income categories (e.g. Groceries, Salary, Rent) |
| `transaction_types` | Transaction classifications (e.g. Debit, Credit, Transfer) |
| `account_balance_history` | Daily cumulative balance snapshots per account |

## Views

| View | Description |
|---|---|
| `v_transactions_full` | Fully joined transaction view with account names, types, categories, and related account info |
| `v_account_balances_current` | Current balance per account with full classification hierarchy (type, category) |
| `v_daily_totals` | Daily transaction totals grouped by transaction type (for income/expense line charts) |

## Balance History

`account_balance_history` stores daily cumulative balances for each account, filling in days with no transactions with a zero daily change.

For the production `Finances` database, the rebuild script is behind a profile and does not run automatically. To run it:

```bash
docker compose --profile init run --rm init-script
```

The `Finances_Test` database has its balance history built automatically as part of the first-launch seed (see below).

## First-Launch Database Initialization

On the first `docker compose up` (empty Postgres data volume), [`init-db/01-create-databases.sh`](../init-db/01-create-databases.sh) runs once inside the postgres container and creates the `Finances` and `Finances_Test` databases plus the Metabase role + database. It does not apply any schema or seed data.

Schema and seeding then come from the `migrate` Compose service, which runs after postgres is healthy. The migrate service:

1. Applies pending Drizzle migrations from [`app/drizzle/migrations/`](../app/drizzle/migrations/) to both `Finances` and `Finances_Test`.
2. Seeds the two **shared lookup tables** (`account_type_categories`, `transaction_types`) into both databases so they start in sync. The Finances side uses `ON CONFLICT DO NOTHING` and is additionally guarded by a pre-flight row-count check — **existing Finances user data is never overwritten**, even on a manual re-run.
3. Seeds `Finances_Test` with mock data: all 19 `account_types`, all 27 `transaction_categories`, 8 accounts, and ~400 transactions spanning the past 12 months relative to `CURRENT_DATE` at seed time.
4. Rebuilds `Finances_Test.account_balance_history` so balances are up-to-date as of today.

`finance-app` and `importer` wait on `migrate: service_completed_successfully` before starting. After the migrate service exits, `Finances` contains only the shared lookups and is ready for the user (or the importer) to populate via normal application use. `Finances_Test` contains a full year of mock activity usable by integration tests and for UI development.

## Test Database

`Finances_Test` is populated automatically on first launch — no manual seeding is required. The seed artifacts live in [`init-db/seeds/`](../init-db/seeds/) and are applied by the `migrate` Compose service:

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

For schema changes, see [Making schema changes](schema-changes.md) — never edit the database by hand.
