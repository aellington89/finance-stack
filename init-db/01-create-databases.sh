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
# schema.sql to both Finances and Finances_Test.
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

echo ">>> Database initialization complete."
