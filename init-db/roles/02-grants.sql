-- ==============================================
-- Per-database privileges for the least-privilege service roles (Issue #130).
--
-- Runs once per target database (Finances, Finances_Test) on every migrate run,
-- AFTER drizzle-kit has applied migrations — grants can only reference tables
-- that already exist, which is why this lives in the migrate service rather than
-- in init-db/01-create-databases.sh. Roles themselves come from 01-create-roles.sql.
--
-- Contains no secrets, so CI applies this exact file to Finances_Test and then
-- gates on assert-grants.sql. One authority, exercised twice.
--
-- Required psql variables:
--   OWNER    the role that owns the tables (POSTGRES_USER) — the role whose
--            future CREATEs the ALTER DEFAULT PRIVILEGES statements attach to.
--   DBNAME   set automatically by psql from the -d connection.
--
-- The grant matrix (see docs/database.md):
--
--   finance_app       DML on every public table except users and audit_log
--                     (SELECT only on both), SELECT on the views, USAGE on the
--                     sequences.
--   finance_importer  SELECT+INSERT on transactions, SELECT on the three lookup
--                     tables it resolves FKs against, and nothing else.
--   finance_bi        SELECT on the seven core base tables and the four views.
--                     Nothing on users or audit_log — that exclusion is the
--                     whole point of the role existing (#249).
--
-- Table ownership stays with OWNER, so no service role can ALTER or DROP the
-- schema, TRUNCATE a table, or touch the `drizzle` migration ledger.
-- ==============================================

\set ON_ERROR_STOP on

-- Atomic: the revoke/re-grant below would otherwise leave a window in which a
-- running finance-app has no privileges and starts erroring mid-request.
BEGIN;

-- ── Retire finance_metabase (#250) ────────────────────────────────────────
-- Removes every privilege it holds in THIS database. The DROP ROLE itself is
-- cluster-global and happens once, after every database has been cleaned — see
-- app/scripts/migrate-and-seed.sh. Split that way because a role cannot be
-- dropped while it still holds a privilege anywhere.
--
-- Guarded, and a no-op on a fresh cluster that never had the role. Left in
-- place rather than deleted after one release: the role is only reachable by
-- an existing volume, and there is no other mechanism that would clean one up.
SELECT 'DROP OWNED BY finance_metabase'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_metabase')\gexec

-- ── Baseline: nothing is implicit ─────────────────────────────────────────
-- PUBLIC (i.e. every role, present and future) loses CONNECT/TEMP on the
-- database and CREATE on the schema. Both are already the default on
-- postgres:18.0 (PG15+ removed the public CREATE grant), asserted here so a
-- restored dump or a hand-run GRANT cannot silently widen the surface.
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Converge: strip every privilege the three roles currently hold in this
-- database before re-granting, so this file is the single authority. Without
-- this, narrowing a grant here would leave the old wider grant in place.
REVOKE ALL ON DATABASE :"DBNAME"          FROM finance_app, finance_importer, finance_bi;
REVOKE ALL ON SCHEMA public               FROM finance_app, finance_importer, finance_bi;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM finance_app, finance_importer, finance_bi;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM finance_app, finance_importer, finance_bi;

ALTER DEFAULT PRIVILEGES FOR ROLE :"OWNER" IN SCHEMA public
    REVOKE ALL ON TABLES FROM finance_app, finance_importer, finance_bi;
ALTER DEFAULT PRIVILEGES FOR ROLE :"OWNER" IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM finance_app, finance_importer, finance_bi;

-- ── finance_app — the Next.js application ─────────────────────────────────
-- Granted broadly ("all tables, minus explicit revokes") rather than as an
-- enumerated list on purpose: broad DML *is* this role's charter (the settings
-- CRUD in lib/actions/categories.ts writes every lookup table), and an
-- enumerated list would silently break the app the first time a migration adds
-- a table. The single REVOKE below keeps the one exception auditable.
GRANT CONNECT ON DATABASE :"DBNAME" TO finance_app;
GRANT USAGE ON SCHEMA public TO finance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO finance_app;

-- users is read-only to the app: credentials are verified here, but accounts are
-- only ever created or reset by `npm run auth:create-user`, which connects as
-- POSTGRES_USER. So an app-level injection or RCE cannot mint an admin user.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON users FROM finance_app;

-- audit_log is read-only to the app for the same reason, and this is what gives
-- the audit trail its value (Issue #180). The app still *causes* audit rows:
-- audit_row_change() is SECURITY DEFINER and owned by OWNER, so the trigger
-- inserts with the owner's rights, not the app's. An app-level compromise can
-- therefore neither forge an entry nor delete one covering its tracks. SELECT is
-- kept so a future reader UI needs no grant change.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM finance_app;

-- accounts.account_id and transactions.transaction_id are `serial`, so INSERT
-- needs USAGE on their sequences. USAGE+SELECT permits nextval/currval but not
-- setval — the lookup tables' GENERATED ALWAYS AS IDENTITY sequences need no
-- grant at all.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO finance_app;

-- Cover tables and sequences created by future migrations. Default privileges
-- attach at CREATE time, so they only help from the *next* migrate run onward —
-- the GRANT ... ON ALL statements above are what cover a fresh database.
ALTER DEFAULT PRIVILEGES FOR ROLE :"OWNER" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finance_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"OWNER" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO finance_app;

-- ── finance_importer — the file importer ──────────────────────────────────
-- Enumerated deliberately: narrowness is the whole point of this role. It
-- appends transactions and resolves FKs by name (importer/poll.py
-- load_lookup_maps + parsers/*.process). It cannot UPDATE or DELETE anything,
-- so a bad parser can only ever add rows — never rewrite history.
GRANT CONNECT ON DATABASE :"DBNAME" TO finance_importer;
GRANT USAGE ON SCHEMA public TO finance_importer;
GRANT SELECT, INSERT ON transactions TO finance_importer;
GRANT SELECT ON accounts, transaction_categories, transaction_types TO finance_importer;

-- Resolved rather than hardcoded, matching init-db/seeds/shared-lookups.sql.
SELECT format('GRANT USAGE, SELECT ON SEQUENCE %s TO finance_importer',
              pg_get_serial_sequence('transactions', 'transaction_id'))\gexec

-- ── finance_bi — Metabase when questions are built on base tables ─────────
-- The one role Metabase authenticates as against Finances. A stricter
-- views-only role (finance_metabase) existed until #250 and was never pointed
-- at: it could not serve questions built directly on `transactions` or
-- `account_balance_history`, and the latter has no view over it at all (#249).
--
-- The alternative on the table was to reuse finance_app, which already holds
-- SELECT on everything. That is what this role exists to avoid: finance_app can
-- read `users`, so a BI credential built from it makes `users.password_hash`
-- reachable from Metabase — and Metabase permits native SQL, so hiding the
-- table in its admin UI is a display setting, not a privilege boundary.
--
-- Enumerated rather than granted ON ALL TABLES, for the reason finance_importer
-- is: the exclusions are the point, and `GRANT ... ON ALL
-- TABLES` followed by a REVOKE would silently re-expose `users` the first time
-- someone re-ran the grant with the REVOKE removed. A table added by a future
-- migration must be added here by hand to become visible to BI.
GRANT CONNECT ON DATABASE :"DBNAME" TO finance_bi;
GRANT USAGE ON SCHEMA public TO finance_bi;
GRANT SELECT ON accounts, account_types, account_type_categories, transactions,
    transaction_categories, transaction_types, account_balance_history
    TO finance_bi;
GRANT SELECT ON v_transactions_full, v_account_balances_current, v_daily_totals,
    v_audit_log
    TO finance_bi;

COMMIT;
