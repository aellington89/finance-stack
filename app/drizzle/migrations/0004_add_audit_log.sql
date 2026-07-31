CREATE TABLE "audit_log" (
	"audit_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text NOT NULL,
	"actor_source" text NOT NULL,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"row_pk" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"changed_columns" text[],
	CONSTRAINT "audit_log_action_check" CHECK (action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])),
	CONSTRAINT "audit_log_actor_source_check" CHECK (actor_source = ANY (ARRAY['app'::text, 'database'::text]))
);
--> statement-breakpoint
CREATE INDEX "idx_audit_log_occurred_at" ON "audit_log" USING btree ("occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_table_row" ON "audit_log" USING btree ("table_name" text_ops,"row_pk" text_ops,"occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE VIEW "public"."v_audit_log" AS (SELECT audit_id, occurred_at, actor_user_id, actor_label, actor_source, action, table_name, row_pk, changed_columns, before_data, after_data FROM audit_log);--> statement-breakpoint
-- ==============================================================
-- Everything below this line is hand-written (Issue #180). Drizzle does not
-- model functions or triggers, so `db:generate` produced only the table, the
-- indexes and the view above; this half was appended before the migration was
-- first applied anywhere. See docs/schema-changes.md — the immutability rule
-- binds from the first apply onward, so any correction ships as 0005+.
--
-- Design notes (full write-up in docs/audit-log.md):
--
--   SECURITY DEFINER is the point of the whole design. The function is owned by
--   POSTGRES_USER, so it inserts into audit_log with the owner's rights and
--   finance_app needs no write privilege on the table at all — 02-grants.sql
--   revokes INSERT/UPDATE/DELETE from it. A compromised application can cause
--   audit rows but can neither forge nor erase them. search_path is pinned so
--   the definer's rights cannot be redirected at a shadowed object.
--
--   EXECUTE is deliberately left with PUBLIC. Postgres checks EXECUTE on a
--   trigger function at CREATE TRIGGER time, not when the trigger fires, and a
--   trigger function called directly errors out ("may only be called as a
--   trigger") — so revoking would buy nothing and risks breaking every write.
--
--   The actor comes from two transaction-local GUCs set by auditedTransaction()
--   in app/lib/db/audited.ts. Anything writing without them — the Python
--   importer as finance_importer, or an operator in psql — is still recorded,
--   attributed to its database role with actor_source = 'database'.
--
--   TG_ARGV[0] carries the table's primary-key column list rather than the
--   function looking it up in the catalog: it keeps the function free of
--   per-row catalog queries and makes each trigger's key visible in this file.
-- ==============================================================
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $audit$
DECLARE
    v_before      jsonb;
    v_after       jsonb;
    v_row         jsonb;
    v_actor_id    uuid;
    v_actor_label text;
    v_source      text;
    v_pk_cols     text[];
    v_pk_parts    text[] := '{}'::text[];
    v_changed     text[];
    v_col         text;
BEGIN
    -- Read in the body rather than as a DECLARE initializer: the order in which
    -- PL/pgSQL populates the trigger special variables relative to block-entry
    -- default expressions is not something to rely on.
    v_pk_cols := string_to_array(TG_ARGV[0], ',');

    IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN v_after  := to_jsonb(NEW); END IF;

    -- DELETE has no NEW row and INSERT has no OLD one, so the key is read from
    -- whichever side exists.
    v_row := coalesce(v_after, v_before);
    FOREACH v_col IN ARRAY v_pk_cols LOOP
        v_pk_parts := v_pk_parts || coalesce(v_row ->> btrim(v_col), '');
    END LOOP;

    IF TG_OP = 'UPDATE' THEN
        SELECT coalesce(array_agg(e.key ORDER BY e.key), '{}'::text[])
          INTO v_changed
          FROM jsonb_each(v_after) AS e
         WHERE e.value IS DISTINCT FROM v_before -> e.key;
    END IF;

    v_actor_id := nullif(current_setting('app.actor_user_id', true), '')::uuid;
    v_actor_label := coalesce(
        nullif(current_setting('app.actor_label', true), ''),
        current_user::text
    );
    v_source := CASE WHEN v_actor_id IS NULL THEN 'database' ELSE 'app' END;

    INSERT INTO public.audit_log (
        actor_user_id, actor_label, actor_source, action,
        table_name, row_pk, before_data, after_data, changed_columns
    ) VALUES (
        v_actor_id, v_actor_label, v_source, TG_OP,
        TG_TABLE_NAME, array_to_string(v_pk_parts, '|'),
        v_before, v_after, v_changed
    );

    RETURN NULL;
END;
$audit$;--> statement-breakpoint
COMMENT ON TABLE "audit_log" IS 'Written only by the audit_row_change() trigger. Never insert into it directly. See docs/audit-log.md.';--> statement-breakpoint
COMMENT ON FUNCTION audit_row_change() IS 'Generic row-level audit trigger. TG_ARGV[0] is the comma-separated primary-key column list for the audited table.';--> statement-breakpoint
-- account_balance_history is deliberately not audited: rebuildAccountBalance()
-- rewrites an account's entire history on every transaction write, so a trigger
-- there would bury the real signal under hundreds of derived rows. users is not
-- audited either — finance_app cannot write it at all, and the only writer is
-- `npm run auth:create-user` connecting as POSTGRES_USER.
CREATE TRIGGER audit_transactions
    AFTER INSERT OR UPDATE OR DELETE ON "transactions"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('transaction_id');--> statement-breakpoint
CREATE TRIGGER audit_accounts
    AFTER INSERT OR UPDATE OR DELETE ON "accounts"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('account_id');--> statement-breakpoint
CREATE TRIGGER audit_transaction_categories
    AFTER INSERT OR UPDATE OR DELETE ON "transaction_categories"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('transaction_category_id');--> statement-breakpoint
CREATE TRIGGER audit_transaction_types
    AFTER INSERT OR UPDATE OR DELETE ON "transaction_types"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('transaction_type_id');--> statement-breakpoint
CREATE TRIGGER audit_account_types
    AFTER INSERT OR UPDATE OR DELETE ON "account_types"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('account_type_id');--> statement-breakpoint
CREATE TRIGGER audit_account_type_categories
    AFTER INSERT OR UPDATE OR DELETE ON "account_type_categories"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('account_type_category_id');