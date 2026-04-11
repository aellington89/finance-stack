#!/bin/bash
# ------------------------------------------------------------
# First-run database initialization for the finance stack.
#
# This script is mounted into /docker-entrypoint-initdb.d/ and
# runs automatically the first time Postgres starts with an
# empty data directory. It is skipped on subsequent starts.
#
# It creates:
#   1. The "Finances" database (the main application database)
#   2. The "Finances_Test" database (test database with same schema)
#   3. The Metabase role and database (for Metabase internal metadata)
#
# After creating the databases, it applies the schema from
# schema.sql to both Finances and Finances_Test, then seeds:
#
#   - Shared lookups (account_type_categories, transaction_types)
#     into BOTH Finances and Finances_Test so they stay synced.
#     Uses ON CONFLICT DO NOTHING; the Finances call is also
#     guarded by a row-count check and is skipped entirely if the
#     database already contains user data. Finances user data is
#     NEVER overwritten.
#
#   - Mock accounts + ~400 transactions covering the past 12
#     months into Finances_Test only, followed by a balance
#     history rebuild.
#
# All credentials are read from environment variables passed
# through docker-compose.yml (sourced from .env).
# ------------------------------------------------------------
set -euo pipefail

echo ">>> Creating Finances database..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE "Finances"'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'Finances')\gexec
EOSQL

echo ">>> Creating Finances_Test database..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE "Finances_Test"'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'Finances_Test')\gexec
EOSQL

echo ">>> Creating Metabase role and database..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${MB_DB_USER}') THEN
        CREATE ROLE ${MB_DB_USER} WITH LOGIN PASSWORD '${MB_DB_PASS}';
      END IF;
    END
    \$\$;

    SELECT 'CREATE DATABASE ${MB_DB_DBNAME} OWNER ${MB_DB_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${MB_DB_DBNAME}')\gexec

    GRANT ALL PRIVILEGES ON DATABASE ${MB_DB_DBNAME} TO ${MB_DB_USER};
EOSQL

# Apply schema to both databases (if schema file exists)
SCHEMA_FILE="/docker-entrypoint-initdb.d/schema.sql"
if [ -f "$SCHEMA_FILE" ]; then
    echo ">>> Applying schema to Finances..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "Finances" -f "$SCHEMA_FILE"

    echo ">>> Applying schema to Finances_Test..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "Finances_Test" -f "$SCHEMA_FILE"
else
    echo ">>> WARNING: schema.sql not found — skipping schema application."
    echo "    Databases were created but have no tables."
    echo "    Place schema.sql in init-db/ and re-initialize, or apply manually."
fi

# ------------------------------------------------------------
# Seed phase
# ------------------------------------------------------------
SEEDS_DIR="/docker-entrypoint-initdb.d/seeds"
SHARED_LOOKUPS="$SEEDS_DIR/shared-lookups.sql"
MOCK_DATA="$SEEDS_DIR/finances-test-mock-data.sql"
REBUILD_BALANCES="$SEEDS_DIR/rebuild-balance-history.sql"

# --- Finances: additive lookup seed, only when the DB is empty. ---
# This is belt-and-suspenders: the init-db directory already only runs on
# an empty data volume, but the pre-flight row-count check below ensures
# that even a manual re-run cannot overwrite user data.
if [ -f "$SHARED_LOOKUPS" ]; then
    FINANCES_TXN_COUNT=$(psql -tAc "SELECT count(*) FROM transactions;" \
        --username "$POSTGRES_USER" --dbname "Finances" 2>/dev/null || echo "")
    FINANCES_ACCT_COUNT=$(psql -tAc "SELECT count(*) FROM accounts;" \
        --username "$POSTGRES_USER" --dbname "Finances" 2>/dev/null || echo "")

    if [ "${FINANCES_TXN_COUNT:-0}" = "0" ] && [ "${FINANCES_ACCT_COUNT:-0}" = "0" ]; then
        echo ">>> Seeding shared lookups into Finances..."
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "Finances" -f "$SHARED_LOOKUPS"
    else
        echo ">>> Skipping Finances seed: DB already contains user data" \
             "(accounts=${FINANCES_ACCT_COUNT}, transactions=${FINANCES_TXN_COUNT})."
    fi

    echo ">>> Seeding shared lookups into Finances_Test..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "Finances_Test" -f "$SHARED_LOOKUPS"
else
    echo ">>> WARNING: $SHARED_LOOKUPS not found — skipping shared lookup seed."
fi

# --- Finances_Test: full reset-style seed. ---
if [ -f "$MOCK_DATA" ]; then
    echo ">>> Seeding mock data into Finances_Test..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "Finances_Test" -f "$MOCK_DATA"
else
    echo ">>> WARNING: $MOCK_DATA not found — skipping Finances_Test mock data."
fi

if [ -f "$REBUILD_BALANCES" ]; then
    echo ">>> Rebuilding Finances_Test account_balance_history..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "Finances_Test" -f "$REBUILD_BALANCES"
else
    echo ">>> WARNING: $REBUILD_BALANCES not found — skipping balance rebuild."
fi

echo ">>> Database initialization complete."
