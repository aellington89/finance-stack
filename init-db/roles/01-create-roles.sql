-- ==============================================
-- Least-privilege service roles (Issue #130).
--
-- Creates the three login roles the long-running services authenticate as,
-- replacing the shared `postgres` superuser:
--   finance_app       — the Next.js app (DML on core tables, SELECT on users)
--   finance_importer  — the file importer (INSERT into transactions + lookups)
--   finance_bi        — Metabase's Finances connection: SELECT on the core
--                       tables and views, nothing on users or audit_log (#249)
--
-- A fourth role, finance_metabase, was retired in #250. It held SELECT on the
-- four views and nothing else — stricter than finance_bi and the better posture
-- — but it could not serve questions built on base tables, and nothing was ever
-- pointed at it in the two years it existed. Two near-identical credentials for
-- one job is how an operator wires up the wrong one. 02-grants.sql drops its
-- privileges and migrate-and-seed.sh drops the role.
--
-- Roles are cluster-global, so this file runs ONCE per migrate run against the
-- maintenance database. Per-database privileges live in 02-grants.sql.
--
-- Applied by the `migrate` Compose service (app/scripts/migrate-and-seed.sh),
-- never by a postgres initdb hook: /docker-entrypoint-initdb.d/ only runs on an
-- empty data directory, so an existing Postgres volume would never gain the
-- roles. The migrate service runs idempotently on every `docker compose up`.
-- Database creation joined it there under #225 for exactly this reason — see
-- 00-create-databases.sql, which runs immediately before this file.
--
-- Required psql variables (passed with -v by the caller):
--   app_password, importer_password, bi_password
--
-- Passwords are interpolated as psql variables rather than shell-expanded into
-- the SQL text, and quoted by format(%L) so a password containing a quote can
-- neither break the statement nor inject SQL. Note that psql does NOT expand
-- :variables inside dollar-quoted strings, which is why this uses \gexec rather
-- than a DO $$ ... $$ block — the same constraint every other file in this
-- directory works around.
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

-- ── finance_bi ────────────────────────────────────────────────────────────
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'finance_bi', :'bi_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_bi')\gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
    ' NOBYPASSRLS PASSWORD %L', 'finance_bi', :'bi_password')\gexec
