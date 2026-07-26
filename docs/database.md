# Database

Covers the schema, views, balance-history table, first-launch initialization, the service roles and their privileges, and the test database.

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

1. Creates the least-privilege service roles, then applies pending Drizzle migrations from [`app/drizzle/migrations/`](../app/drizzle/migrations/) to both `Finances` and `Finances_Test` and grants each role its privileges — see [Roles & Privileges](#roles--privileges).
2. Seeds the two **shared lookup tables** (`account_type_categories`, `transaction_types`) into both databases so they start in sync. The Finances side uses `ON CONFLICT DO NOTHING` and is additionally guarded by a pre-flight row-count check — **existing Finances user data is never overwritten**, even on a manual re-run.
3. Seeds `Finances_Test` with mock data: all 19 `account_types`, all 27 `transaction_categories`, 8 accounts, and ~400 transactions spanning the past 12 months relative to `CURRENT_DATE` at seed time.
4. Rebuilds `Finances_Test.account_balance_history` so balances are up-to-date as of today.

`finance-app` and `importer` wait on `migrate: service_completed_successfully` before starting. After the migrate service exits, `Finances` contains only the shared lookups and is ready for the user (or the importer) to populate via normal application use. `Finances_Test` contains a full year of mock activity usable by integration tests and for UI development.

## Roles & Privileges

The long-running services do **not** connect as the `postgres` superuser (Issue #130). Each authenticates as its own login role, scoped to what it actually does:

| Role | Used by | Privileges |
|---|---|---|
| `finance_app` | `finance-app` | `SELECT`/`INSERT`/`UPDATE`/`DELETE` on every table **except `users`, which is `SELECT`-only**; `SELECT` on the views; `USAGE` on the sequences |
| `finance_importer` | `importer` | `SELECT` + `INSERT` on `transactions`; `SELECT` on `accounts`, `transaction_categories`, `transaction_types`. No `UPDATE`, no `DELETE` |
| `finance_metabase` | Metabase's Finances connection | `SELECT` on the three views. **No privilege on any base table** |

None of them is a superuser, none can create databases or roles, and none has `CREATE` on schema `public` — so no service can add, alter, drop, or truncate a table, and none can reach the `drizzle` migration ledger. Tables stay owned by `POSTGRES_USER`, which is what makes that true.

The superuser is still used, deliberately, by the jobs that need DDL or cluster-wide reads: `migrate`, `init-script`, and `pg-backup`. Those are maintenance jobs with no network-facing surface.

Two details worth knowing before you change any of this:

- **`finance_metabase` works without base-table access** because the three views are created without `security_invoker`, so they execute with the view *owner's* rights. `SELECT` on the view is sufficient, and the underlying tables stay invisible in Metabase's data browser. Add `security_invoker` to a view and this role stops being able to read it.
- **`finance_app` is granted broadly and then revoked** (`GRANT … ON ALL TABLES`, then `REVOKE … ON users`) plus `ALTER DEFAULT PRIVILEGES`, so a table added by a future migration is covered automatically. The two narrow roles are enumerated instead — if a migration adds a table or view they need, [`init-db/roles/02-grants.sql`](../init-db/roles/02-grants.sql) must be updated by hand.

### How the roles are applied

Roles and grants are applied by the **`migrate` service** on every `docker compose up`, not by `init-db/01-create-databases.sh`. Two reasons: that script only runs on an empty data directory, so an existing Postgres volume would never gain the roles; and a `GRANT` names tables, so it can only run after migrations have created them.

| File | Purpose |
|---|---|
| [`init-db/roles/01-create-roles.sql`](../init-db/roles/01-create-roles.sql) | Creates the three login roles (cluster-global, so it runs once per migrate run) |
| [`init-db/roles/02-grants.sql`](../init-db/roles/02-grants.sql) | Applies the matrix above to one database; run against `Finances` and `Finances_Test` |
| [`init-db/roles/assert-grants.sql`](../init-db/roles/assert-grants.sql) | Asserts the matrix against the catalog — the CI grant gate |

`02-grants.sql` **revokes before it grants**, inside a transaction, so it converges: a privilege widened by hand is removed on the next `up`, and there is no window in which a running app has no access.

### Verifying the roles

[`scripts/verify-db-roles.sh`](../scripts/verify-db-roles.sh) checks both layers — the catalog matrix, then a behavioural smoke that connects as each role and asserts that permitted statements succeed and forbidden ones are refused with `SQLSTATE 42501`. Writes are rolled back, so it is safe against a populated database:

```bash
docker compose run --rm --entrypoint bash migrate /scripts/verify-db-roles.sh Finances
```

The `migrate` service already carries every variable the script needs, so no `-e` flags are required. CI runs the same script against `Finances_Test` on every PR.

### Rotating a role password

Edit the relevant `FINANCE_*_DB_PASSWORD` in `.env`, then re-run the migrate service — `01-create-roles.sql` issues an unconditional `ALTER ROLE … PASSWORD`, so the new value takes effect with no manual SQL:

```bash
docker compose run --rm migrate
docker compose up -d --force-recreate finance-app importer
```

Passwords are interpolated into URL-form connection strings, so keep them URL-safe or percent-encode them.

> **This works for the three `FINANCE_*_DB_PASSWORD` values only.** `POSTGRES_PASSWORD` and `MB_DB_PASS` are *not* rotatable from `.env`: the Postgres image applies `POSTGRES_PASSWORD` solely via `initdb` on an empty data directory, and the Metabase role is created by `init-db/01-create-databases.sh`, which the entrypoint skips once `PGDATA` is initialized. Editing either value on an existing volume leaves the stored password unchanged and breaks every service that authenticates with the new one (loudly — `migrate` fails on `password authentication failed`). To change them, alter the role first, then update `.env`:
>
> ```bash
> docker compose exec postgres psql -U postgres    # then: \password postgres   (or \password metabase_user)
> # update POSTGRES_PASSWORD / MB_DB_PASS in .env to the same value
> docker compose up -d --force-recreate
> ```
>
> The service roles avoid this trap because `01-create-roles.sql` re-issues `ALTER ROLE … PASSWORD` on every migrate run.

### Pointing Metabase at `finance_metabase`

Metabase stores its analytics connections in its own metadata database, not in environment variables, so this one role cannot be wired through `docker-compose.yml` — it is a one-time manual step. In Metabase, go to **Settings → Admin → Databases → your Finances database**, change the username to `finance_metabase` and the password to `FINANCE_METABASE_DB_PASSWORD`, and save. Existing questions built on the three views keep working; anything built directly on a base table will stop, which is the intended outcome.

`MB_DB_USER` is unrelated and unchanged — it owns Metabase's *internal* metadata database and was never the superuser.

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
