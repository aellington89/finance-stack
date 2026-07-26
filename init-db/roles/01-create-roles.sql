-- ==============================================
-- Least-privilege service roles (Issue #130).
--
-- Creates the three login roles the long-running services authenticate as,
-- replacing the shared `postgres` superuser:
--   finance_app       — the Next.js app (DML on core tables, SELECT on users)
--   finance_importer  — the file importer (INSERT into transactions + lookups)
--   finance_metabase  — Metabase's Finances connection (SELECT on views only)
--
-- Roles are cluster-global, so this file runs ONCE per migrate run against the
-- maintenance database. Per-database privileges live in 02-grants.sql.
--
-- Applied by the `migrate` Compose service (app/scripts/migrate-and-seed.sh),
-- not by init-db/01-create-databases.sh: that script only runs on an empty data
-- directory, so an existing Postgres volume would never gain the roles. The
-- migrate service runs idempotently on every `docker compose up`.
--
-- Required psql variables (passed with -v by the caller):
--   app_password, importer_password, metabase_password
--
-- Passwords are interpolated as psql variables rather than shell-expanded into
-- the SQL text, and quoted by format(%L) so a password containing a quote can
-- neither break the statement nor inject SQL. Note that psql does NOT expand
-- :variables inside dollar-quoted strings, which is why this uses \gexec rather
-- than a DO $$ ... $$ block (the pattern 01-create-databases.sh already uses).
--
-- Each role gets two statements: a guarded CREATE, then an unconditional ALTER.
-- The ALTER re-asserts the attribute set and syncs the password, so rotating a
-- password in .env takes effect on the next `up` with no manual SQL.
-- ==============================================

\set ON_ERROR_STOP on

-- ── finance_app ───────────────────────────────────────────────────────────
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'finance_app', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_app')\gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
    ' NOBYPASSRLS PASSWORD %L', 'finance_app', :'app_password')\gexec

-- ── finance_importer ──────────────────────────────────────────────────────
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'finance_importer', :'importer_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_importer')\gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
    ' NOBYPASSRLS PASSWORD %L', 'finance_importer', :'importer_password')\gexec

-- ── finance_metabase ──────────────────────────────────────────────────────
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'finance_metabase', :'metabase_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_metabase')\gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
    ' NOBYPASSRLS PASSWORD %L', 'finance_metabase', :'metabase_password')\gexec
