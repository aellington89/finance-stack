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
#
# This file is NOT the authority on what MB_DB_USER may do. It runs
# once, on an empty PGDATA, and never again — so nothing here can
# correct a role on an existing volume. That is exactly how the live
# cluster ended up with a SUPERUSER metabase_user while this script
# still read like it created a scoped login (issue #239). The
# convergent authority is init-db/roles/03-metabase-role.sql, applied
# by the migrate service on every `docker compose up`.
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

# The attribute list is spelled out even though every one of these is the
# Postgres default for CREATE ROLE. A reader of this file has to be able to see
# the intended privilege level without knowing the defaults by heart — the bare
# `WITH LOGIN PASSWORD` this used to carry read as "scoped login" while the live
# role was a superuser, and no one could tell from here (issue #239).
echo ">>> Creating Metabase role and database..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${MB_DB_USER}') THEN
        CREATE ROLE ${MB_DB_USER} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS PASSWORD '${MB_DB_PASS}';
      END IF;
    END
    \$\$;

    SELECT 'CREATE DATABASE ${MB_DB_DBNAME} OWNER ${MB_DB_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${MB_DB_DBNAME}')\gexec

    GRANT ALL PRIVILEGES ON DATABASE ${MB_DB_DBNAME} TO ${MB_DB_USER};
EOSQL

echo ">>> Database creation complete. Schema + seed application happens in the migrate service."
