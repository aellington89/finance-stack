CREATE TABLE "recurring_transactions" (
	"recurring_transaction_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_transactions_recurring_transaction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_description" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"account_id" integer NOT NULL,
	"related_account_id" integer,
	"transaction_type_id" integer NOT NULL,
	"transaction_category_id" integer NOT NULL,
	"cadence" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"anchor_date" date NOT NULL,
	"next_run_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recurring_transactions_description_not_blank" CHECK (transaction_description <> ''),
	CONSTRAINT "recurring_transactions_cadence_check" CHECK (cadence = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'yearly'::text])),
	CONSTRAINT "recurring_transactions_interval_count_range" CHECK (interval_count >= 1 AND interval_count <= 99),
	CONSTRAINT "recurring_transactions_next_not_before_anchor" CHECK (next_run_date >= anchor_date),
	CONSTRAINT "recurring_transactions_end_not_before_anchor" CHECK (end_date IS NULL OR end_date >= anchor_date),
	CONSTRAINT "recurring_transactions_related_differs" CHECK (related_account_id IS NULL OR related_account_id <> account_id)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_transaction_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_occurrence_date" date;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_related_account_id_fkey" FOREIGN KEY ("related_account_id") REFERENCES "public"."accounts"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_transaction_type_id_fkey" FOREIGN KEY ("transaction_type_id") REFERENCES "public"."transaction_types"("transaction_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_transaction_category_id_fkey" FOREIGN KEY ("transaction_category_id") REFERENCES "public"."transaction_categories"("transaction_category_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recurring_transactions_due" ON "recurring_transactions" USING btree ("next_run_date" date_ops) WHERE is_active AND (end_date IS NULL OR next_run_date <= end_date);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_occurrence_key" UNIQUE("recurring_transaction_id","recurring_occurrence_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_link_pair" CHECK ((recurring_transaction_id IS NULL) = (recurring_occurrence_date IS NULL));--> statement-breakpoint
-- ==============================================
-- Hand-authored (Issue #135). Everything below this line is not generated:
-- drizzle-kit does not model triggers or comments (docs/schema-changes.md
-- step 4), and the drift gate cannot see it, so the audit trigger is proven by
-- tests/integration/actions/audit.test.ts instead.
--
-- recurring_transactions holds one template per recurring transaction. The
-- scheduler in lib/recurring/ creates each due occurrence as an ordinary
-- transactions row, stamped with the template id and the scheduled date.
--
-- The (recurring_transaction_id, recurring_occurrence_date) UNIQUE is the
-- idempotency guarantee, not a convenience: the scheduler locks the template
-- row before it inserts, but a constraint is what makes a second insert of the
-- same occurrence impossible for any writer. NULLs are distinct, so the rows a
-- person entered never conflict.
--
-- The link has no foreign key, for the reason duplicated_from_transaction_id
-- has none (migration 0008): it is provenance, and "created by template #4"
-- stays true after #4 is deleted. RESTRICT would block deleting a template
-- that has history; SET NULL would rewrite every row it created and write an
-- UPDATE audit row for each. The id is an identity and is never reused.
--
-- Adding the CHECK and the UNIQUE on transactions scans it once under an
-- exclusive lock. If this migration hangs, check pg_stat_activity for an
-- idle-in-transaction session holding a lock on transactions (Issue #124).
--
-- Grants: finance_app is covered by the default privileges, finance_bi is
-- granted in init-db/roles/02-grants.sql, and finance_importer gets nothing.
--
-- Backward-compatible: a new table the previous app version never reads, and
-- two nullable columns its inserts never name, so neither the CHECK nor the
-- UNIQUE can reject them. Rolled back, templates simply stop being run.
-- ==============================================
CREATE TRIGGER audit_recurring_transactions
    AFTER INSERT OR UPDATE OR DELETE ON "recurring_transactions"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('recurring_transaction_id');--> statement-breakpoint
COMMENT ON TABLE "recurring_transactions" IS 'One recurring transaction template per row (Issue #135). Due occurrences are created as transactions rows by lib/recurring/materialize.ts. See docs/database.md.';--> statement-breakpoint
COMMENT ON COLUMN "recurring_transactions"."anchor_date" IS 'Occurrence 0 of the current schedule. Every occurrence is computed from it, never from the previous one, so a monthly schedule on the 31st does not drift. Reset to next_run_date when the cadence, interval or next date is edited.';--> statement-breakpoint
COMMENT ON COLUMN "recurring_transactions"."next_run_date" IS 'The next occurrence not yet created; always an occurrence of anchor_date. Due when <= CURRENT_DATE.';--> statement-breakpoint
COMMENT ON COLUMN "recurring_transactions"."end_date" IS 'The last date an occurrence may fall on, inclusive. NULL means no end. The template reads Ended once next_run_date passes it.';--> statement-breakpoint
COMMENT ON COLUMN "transactions"."recurring_transaction_id" IS 'The recurring template that created this row (Issue #135), NULL for rows entered by hand. No FK by design: provenance survives the template being deleted.';--> statement-breakpoint
COMMENT ON COLUMN "transactions"."recurring_occurrence_date" IS 'The scheduled date this row was created for. With recurring_transaction_id, the idempotency key; editing transaction_date leaves it alone.';
