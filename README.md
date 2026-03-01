# Finance Stack

A containerized personal finance data warehouse for aggregating, storing, and visualizing multi-account financial data.

## Stack

| Service | Description | Local Port |
|---|---|---|
| PostgreSQL 18 | Primary database | 5433 |
| Metabase | BI dashboards and analytics | 3000 |
| Appsmith EE | Internal app builder | 8080 |

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

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
2. Start Metabase and Appsmith

### 3. Access the services

- **Metabase:** http://localhost:3000
- **Appsmith:** http://localhost:8080
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
├── init-db/
│   ├── 01-create-databases.sh            # First-run DB/role creation (auto-runs on empty data dir)
│   └── schema.sql                        # Table definitions (applied to Finances and Finances_Test)
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
