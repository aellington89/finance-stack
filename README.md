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

### 1. Start the stack

```bash
docker compose up
```

This will:
1. Start PostgreSQL and wait until it is healthy
2. Run `UpdateAccountBalanceHistory.sql` to rebuild daily cumulative balances
3. Start Metabase and Appsmith

### 2. Access the services

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

`account_balance_history` is rebuilt automatically every time the stack starts via the `init-script` service. It calculates a running cumulative balance for each account for every calendar day, filling in days with no transactions with a zero daily change.

To run it manually:

```bash
docker compose run --rm init-script
```

## Project Structure

```
finance-stack/
├── docker-compose.yml            # Infrastructure definition
└── scripts/
    └── UpdateAccountBalanceHistory.sql   # Balance history rebuild script
```

## Stopping the Stack

```bash
docker compose down
```

Data is persisted in Docker volumes and will be available on next startup.

## Updates

- **2025-02-27 — PostgreSQL 18 volume path fix:** Changed the Postgres volume mount from `/var/lib/postgresql/data` to `/var/lib/postgresql` to match PG18's updated `PGDATA` directory.
