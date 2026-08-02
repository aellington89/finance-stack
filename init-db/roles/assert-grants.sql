-- ==============================================
-- Grant-matrix gate (Issue #130).
--
-- Asserts that the privileges 02-grants.sql is supposed to have established are
-- exactly what the catalog reports — positively (each role CAN do its job) and
-- negatively (each role CANNOT do anything else). Raises an exception listing
-- every violation, so one run reports all problems rather than the first.
--
-- Run against the same database 02-grants.sql was applied to:
--   psql -v ON_ERROR_STOP=1 -d Finances_Test -f init-db/roles/assert-grants.sql
--
-- MUST BE RUN AS THE MAINTENANCE SUPERUSER (POSTGRES_USER). The attribute
-- sweep below exempts `current_user` and nothing else, so running this as some
-- other role asserts something subtly different from what it appears to (issue
-- #239). Every caller already satisfies this: CI sets PGUSER=postgres, and
-- scripts/verify-db-roles.sh inherits the migrate service's PGUSER.
--
-- Wired into CI as the "grant matrix gate" (.github/workflows/ci.yml). Catalog
-- assertions alone cannot prove that SELECT-on-a-view-without-base-table-access
-- actually works at query time, so CI pairs this with a behavioural smoke that
-- connects as each role. Keep both in sync with docs/database.md.
-- ==============================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    failures text[] := '{}';
    db       text   := current_database();
    txn_seq  text   := pg_get_serial_sequence('transactions', 'transaction_id');
    acct_seq text   := pg_get_serial_sequence('accounts', 'account_id');
    r        record;
    t        text;
BEGIN
    -- ── Every login role in the cluster, not a list of three ──────────────
    -- This used to iterate ARRAY['finance_app','finance_importer',
    -- 'finance_metabase'], which is why a SUPERUSER metabase_user sat beside
    -- them for months without the gate having an opinion about it (issue #239).
    -- A role added later — by a future service, or by hand — now fails here by
    -- default rather than being invisible to the check.
    --
    -- current_user is the one exemption: this file is run by the maintenance
    -- superuser, which is deliberately privileged (migrate, init-script and
    -- pg-backup need DDL and cluster-wide reads). Exempting the running
    -- identity rather than a hardcoded 'postgres' keeps POSTGRES_USER
    -- configurable — and a DO block cannot read a psql :variable anyway, which
    -- is the same constraint 01-create-roles.sql works around with \gexec.
    --
    -- The pg_ prefix filter is belt-and-braces: the predefined roles
    -- (pg_monitor, pg_read_all_data, …) all have rolcanlogin = false.
    FOR r IN
        SELECT * FROM pg_roles
        WHERE rolcanlogin
          AND rolname <> current_user
          AND rolname NOT LIKE 'pg\_%'
        ORDER BY rolname
    LOOP
        t := r.rolname;
        IF r.rolsuper         THEN failures := failures || format('%s is SUPERUSER', t); END IF;
        IF r.rolcreatedb      THEN failures := failures || format('%s has CREATEDB', t); END IF;
        IF r.rolcreaterole    THEN failures := failures || format('%s has CREATEROLE', t); END IF;
        IF r.rolreplication   THEN failures := failures || format('%s has REPLICATION', t); END IF;
        IF r.rolbypassrls     THEN failures := failures || format('%s has BYPASSRLS', t); END IF;

        -- A login role the stack does not declare has no business reaching this
        -- database at all. This is the assertion that contains the Metabase
        -- metadata role (which owns its own database and needs nothing here) —
        -- and it is what makes a hand-added role fail rather than pass quietly.
        IF t <> ALL (ARRAY['finance_app', 'finance_importer', 'finance_metabase', 'finance_bi'])
           AND has_database_privilege(t, db, 'CONNECT') THEN
            failures := failures || format(
                'undeclared login role %s has CONNECT on %s', t, db);
        END IF;
    END LOOP;

    -- ── The three service roles exist and are scoped to this database ─────
    -- Attributes are covered by the sweep above; what is left here is
    -- existence and the per-database privileges only these three should hold.
    FOREACH t IN ARRAY ARRAY['finance_app', 'finance_importer', 'finance_metabase', 'finance_bi']
    LOOP
        SELECT * INTO r FROM pg_roles WHERE rolname = t;
        IF NOT FOUND THEN
            failures := failures || format('role %s does not exist', t);
            CONTINUE;
        END IF;
        IF NOT r.rolcanlogin  THEN failures := failures || format('%s cannot LOGIN', t); END IF;

        -- Every role connects and reads the schema, and none may create in it.
        IF NOT has_database_privilege(t, db, 'CONNECT') THEN
            failures := failures || format('%s cannot CONNECT to %s', t, db);
        END IF;
        IF has_database_privilege(t, db, 'CREATE') THEN
            failures := failures || format('%s has CREATE on database %s', t, db);
        END IF;
        IF NOT has_schema_privilege(t, 'public', 'USAGE') THEN
            failures := failures || format('%s lacks USAGE on schema public', t);
        END IF;
        IF has_schema_privilege(t, 'public', 'CREATE') THEN
            failures := failures || format('%s has CREATE on schema public', t);
        END IF;
        -- No role may reach the drizzle migration ledger. Guarded because the
        -- schema only exists once drizzle-kit has run; applying the migration
        -- SQL by hand (as a throwaway verification DB does) leaves it absent.
        IF to_regnamespace('drizzle') IS NOT NULL
           AND has_schema_privilege(t, 'drizzle', 'USAGE') THEN
            failures := failures || format('%s has USAGE on schema drizzle', t);
        END IF;
    END LOOP;

    -- ── finance_app: DML on the core tables ───────────────────────────────
    FOREACH t IN ARRAY ARRAY['accounts', 'account_types', 'account_type_categories',
                             'transactions', 'transaction_categories',
                             'transaction_types', 'account_balance_history']
    LOOP
        IF NOT has_table_privilege('finance_app', t, 'SELECT')
           OR NOT has_table_privilege('finance_app', t, 'INSERT')
           OR NOT has_table_privilege('finance_app', t, 'UPDATE')
           OR NOT has_table_privilege('finance_app', t, 'DELETE') THEN
            failures := failures || format('finance_app lacks full DML on %s', t);
        END IF;
        IF has_table_privilege('finance_app', t, 'TRUNCATE') THEN
            failures := failures || format('finance_app can TRUNCATE %s', t);
        END IF;
    END LOOP;

    -- users is read-only to the app.
    IF NOT has_table_privilege('finance_app', 'users', 'SELECT') THEN
        failures := failures || 'finance_app cannot SELECT users';
    END IF;
    FOREACH t IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
    LOOP
        IF has_table_privilege('finance_app', 'users', t) THEN
            failures := failures || format('finance_app can %s users', t);
        END IF;
    END LOOP;

    -- audit_log is read-only to the app for the same reason, and that is what
    -- makes the trail trustworthy (Issue #180). The app still causes audit rows
    -- via the SECURITY DEFINER trigger, which needs no privilege of its own.
    IF NOT has_table_privilege('finance_app', 'audit_log', 'SELECT') THEN
        failures := failures || 'finance_app cannot SELECT audit_log';
    END IF;
    FOREACH t IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
    LOOP
        IF has_table_privilege('finance_app', 'audit_log', t) THEN
            failures := failures || format('finance_app can %s audit_log', t);
        END IF;
    END LOOP;

    -- Views readable; serial sequences usable but not resettable (no setval).
    FOREACH t IN ARRAY ARRAY['v_transactions_full', 'v_account_balances_current',
                             'v_daily_totals', 'v_audit_log']
    LOOP
        IF NOT has_table_privilege('finance_app', t, 'SELECT') THEN
            failures := failures || format('finance_app cannot SELECT %s', t);
        END IF;
    END LOOP;
    IF NOT has_sequence_privilege('finance_app', txn_seq, 'USAGE')
       OR NOT has_sequence_privilege('finance_app', acct_seq, 'USAGE') THEN
        failures := failures || 'finance_app lacks USAGE on the serial sequences';
    END IF;
    IF has_sequence_privilege('finance_app', txn_seq, 'UPDATE') THEN
        failures := failures || 'finance_app can setval the transactions sequence';
    END IF;

    -- ── finance_importer: append-only on transactions + lookup reads ──────
    IF NOT has_table_privilege('finance_importer', 'transactions', 'SELECT')
       OR NOT has_table_privilege('finance_importer', 'transactions', 'INSERT') THEN
        failures := failures || 'finance_importer cannot SELECT+INSERT transactions';
    END IF;
    FOREACH t IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE']
    LOOP
        IF has_table_privilege('finance_importer', 'transactions', t) THEN
            failures := failures || format('finance_importer can %s transactions', t);
        END IF;
    END LOOP;
    FOREACH t IN ARRAY ARRAY['accounts', 'transaction_categories', 'transaction_types']
    LOOP
        IF NOT has_table_privilege('finance_importer', t, 'SELECT') THEN
            failures := failures || format('finance_importer cannot SELECT %s', t);
        END IF;
        IF has_table_privilege('finance_importer', t, 'INSERT') THEN
            failures := failures || format('finance_importer can INSERT %s', t);
        END IF;
    END LOOP;
    FOREACH t IN ARRAY ARRAY['users', 'audit_log', 'account_balance_history',
                             'account_types', 'v_transactions_full']
    LOOP
        IF has_table_privilege('finance_importer', t, 'SELECT') THEN
            failures := failures || format('finance_importer can SELECT %s', t);
        END IF;
    END LOOP;
    IF NOT has_sequence_privilege('finance_importer', txn_seq, 'USAGE') THEN
        failures := failures || 'finance_importer lacks USAGE on the transactions sequence';
    END IF;
    IF has_sequence_privilege('finance_importer', acct_seq, 'USAGE') THEN
        failures := failures || 'finance_importer has USAGE on the accounts sequence';
    END IF;

    -- ── finance_metabase: the four views, nothing else ────────────────────
    FOREACH t IN ARRAY ARRAY['v_transactions_full', 'v_account_balances_current',
                             'v_daily_totals', 'v_audit_log']
    LOOP
        IF NOT has_table_privilege('finance_metabase', t, 'SELECT') THEN
            failures := failures || format('finance_metabase cannot SELECT %s', t);
        END IF;
        IF has_table_privilege('finance_metabase', t, 'INSERT') THEN
            failures := failures || format('finance_metabase can INSERT %s', t);
        END IF;
    END LOOP;
    FOREACH t IN ARRAY ARRAY['transactions', 'accounts', 'account_types',
                             'account_type_categories', 'transaction_categories',
                             'transaction_types', 'account_balance_history', 'users',
                             'audit_log']
    LOOP
        IF has_table_privilege('finance_metabase', t, 'SELECT') THEN
            failures := failures || format('finance_metabase can SELECT base table %s', t);
        END IF;
    END LOOP;

    -- ── finance_bi: the core tables and views, never users or audit_log ───
    -- The exclusions are the reason this role exists rather than reusing
    -- finance_app, so they are asserted first and by name (#249).
    FOREACH t IN ARRAY ARRAY['users', 'audit_log']
    LOOP
        IF has_table_privilege('finance_bi', t, 'SELECT') THEN
            failures := failures || format('finance_bi can SELECT %s', t);
        END IF;
    END LOOP;

    FOREACH t IN ARRAY ARRAY['accounts', 'account_types', 'account_type_categories',
                             'transactions', 'transaction_categories',
                             'transaction_types', 'account_balance_history',
                             'v_transactions_full', 'v_account_balances_current',
                             'v_daily_totals', 'v_audit_log']
    LOOP
        IF NOT has_table_privilege('finance_bi', t, 'SELECT') THEN
            failures := failures || format('finance_bi cannot SELECT %s', t);
        END IF;
        -- Read-only in the strong sense: analytics must never write.
        IF has_table_privilege('finance_bi', t, 'INSERT')
           OR has_table_privilege('finance_bi', t, 'UPDATE')
           OR has_table_privilege('finance_bi', t, 'DELETE')
           OR has_table_privilege('finance_bi', t, 'TRUNCATE') THEN
            failures := failures || format('finance_bi can write %s', t);
        END IF;
    END LOOP;

    -- ── PUBLIC holds nothing on this database ─────────────────────────────
    IF has_database_privilege('public', db, 'CONNECT') THEN
        failures := failures || format('PUBLIC still has CONNECT on %s', db);
    END IF;
    IF has_schema_privilege('public', 'public', 'CREATE') THEN
        failures := failures || 'PUBLIC still has CREATE on schema public';
    END IF;

    IF array_length(failures, 1) > 0 THEN
        RAISE EXCEPTION E'grant matrix violations in %:\n  - %',
            db, array_to_string(failures, E'\n  - ');
    END IF;

    RAISE NOTICE 'grant matrix OK for % (finance_app, finance_importer, finance_metabase, finance_bi); '
                 'attribute sweep OK for every login role except %', db, current_user;
END
$$;
