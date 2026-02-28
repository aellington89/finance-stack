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
#   2. The Metabase role and database (for Metabase internal metadata)
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

echo ">>> Database initialization complete."
