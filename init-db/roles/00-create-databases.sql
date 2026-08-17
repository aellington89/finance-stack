-- ==============================================
-- Database creation (Issue #225).
--
-- Creates the databases the stack runs on, plus the role that owns Metabase's
-- metadata database:
--   :app_db     the main application database  (FINANCE_APP_DB, default Finances)
--   :test_db    the test database              (Finances_Test)
--   :mb_user    Metabase's metadata-DB role    (MB_DB_USER)
--   :mb_dbname  its metadata database          (MB_DB_DBNAME)
--
-- Applied by the `migrate` Compose service (app/scripts/migrate-and-seed.sh) as
-- step 0, before anything else touches a database. It used to be
-- init-db/01-create-databases.sh, mounted into the postgres container's
-- /docker-entrypoint-initdb.d/ — which meant it ran only on an empty data
-- directory, once, and never again. That is the same trap that moved roles and
-- grants out of it under #130: a database added to this file would never appear
-- on an existing volume, silently. Running it from migrate makes first install
-- and upgrade the identical code path, and it is what finally let the postgres
-- service drop its last bind mount (a prerequisite for #223's deploy bundle).
--
-- Every statement is a guarded CREATE, so re-running is a no-op. CREATE DATABASE
-- cannot run inside a transaction block; psql is in autocommit here and \gexec
-- issues each generated statement on its own, so that constraint is satisfied
-- without anything special.
--
-- Names and the password are interpolated as psql variables through
-- format(%I)/format(%L) rather than shell-expanded into the SQL text — the
-- predecessor script built its SQL with "${MB_DB_PASS}" in a heredoc, so a
-- password containing a quote could break the statement or inject SQL. Note psql
-- does NOT expand :variables inside dollar-quoted strings, which is why this uses
-- \gexec rather than DO $$ ... $$: the same constraint 01-create-roles.sql and
-- 03-metabase-role.sql work around.
--
-- Required psql variables (passed with -v by the caller):
--   app_db, test_db, mb_user, mb_dbname, mb_password
-- ==============================================

\set ON_ERROR_STOP on

-- ── The application databases ─────────────────────────────────────────────
-- :app_db comes from FINANCE_APP_DB, the same variable migrate-and-seed.sh
-- migrates and seeds. The predecessor script hardcoded "Finances" while migrate
-- honoured the variable, so a customized FINANCE_APP_DB created one database and
-- migrated a different, nonexistent one. One variable now drives both.
SELECT format('CREATE DATABASE %I', :'app_db')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'app_db')\gexec

SELECT format('CREATE DATABASE %I', :'test_db')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'test_db')\gexec

-- ── Metabase's metadata role and database ─────────────────────────────────
-- Provisioned only when MB_DB_PASS is non-empty. A cluster that has never
-- provisioned Metabase is a valid configuration and must not be forced to carry
-- the credential; the guard is on the password specifically because that is the
-- one value this cannot invent a default for, and creating a login role with a
-- blank one is the failure the #130 service-role guards exist to prevent. It is
-- checked here rather than in the caller because psql cannot be handed an unset
-- :variable at all — an omitted -v is a syntax error, not an absent value.
--
-- The role comes first: the database names it as owner.
--
-- The attribute list is spelled out even though every one of these is the
-- Postgres default for CREATE ROLE. A reader has to be able to see the intended
-- privilege level without knowing the defaults by heart — the bare
-- `WITH LOGIN PASSWORD` this used to carry read as "scoped login" while the live
-- role was a superuser, and no one could tell from here (issue #239).
--
-- Nothing else is granted. init-db/roles/03-metabase-role.sql is the declared
-- authority on what this role may do and runs moments later in the same job:
-- it converges ownership, revokes PUBLIC, grants CONNECT/TEMPORARY plus
-- USAGE/CREATE on the public schema, and re-syncs the password. The predecessor
-- script also issued GRANT ALL PRIVILEGES ON DATABASE here; two files granting
-- the same thing is how they drift apart.
SELECT format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
              ' NOREPLICATION NOBYPASSRLS PASSWORD %L', :'mb_user', :'mb_password')
WHERE :'mb_password' <> ''
  AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'mb_user')\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'mb_dbname', :'mb_user')
WHERE :'mb_password' <> ''
  AND NOT EXISTS (SELECT FROM pg_database WHERE datname = :'mb_dbname')\gexec

-- Says what the run left in place, since every statement above is silent both
-- when its guard is false and when the object already exists.
SELECT format('%s, %s', quote_ident(:'app_db'), quote_ident(:'test_db'))
           AS "databases",
       CASE
           WHEN :'mb_password' = ''
               THEN 'skipped — MB_DB_PASS is empty'
           ELSE format('%s owned by %s',
                       quote_ident(:'mb_dbname'), quote_ident(:'mb_user'))
       END AS "metabase";
