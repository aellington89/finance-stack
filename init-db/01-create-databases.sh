#!/bin/bash
# ------------------------------------------------------------
# First-run database creation for the finance stack.
#
# This script is mounted into /docker-entrypoint-initdb.d/ and
# runs automatically the first time Postgres starts with an
# empty data directory. It is skipped on subsequent starts.
#
# It only creates databases and the Metabase role:
#   1. The "Finances" database (the main application database)
#   2. The "Finances_Test" database (test database with same schema)
#   3. The Metabase role and database (for Metabase internal metadata)
#
# Schema application and seeding are handled by the `migrate`
# Compose service (which runs `drizzle-kit migrate` against both
# Finances and Finances_Test, then applies init-db/seeds/*.sql).
# Keeping that work outside the postgres init container avoids
# the chicken-and-egg of needing tables before they're migrated.
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

echo ">>> Database creation complete. Schema + seed application happens in the migrate service."
