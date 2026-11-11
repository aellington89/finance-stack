CREATE TABLE "balance_transfers" (
	"balance_transfer_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "balance_transfers_balance_transfer_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transfer_transaction_id" integer NOT NULL,
	"fee_transaction_id" integer,
	"promo_end_date" date NOT NULL,
	"promo_apr" numeric(6, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "balance_transfers_transfer_transaction_id_key" UNIQUE("transfer_transaction_id"),
	CONSTRAINT "balance_transfers_fee_transaction_id_key" UNIQUE("fee_transaction_id"),
	CONSTRAINT "balance_transfers_fee_not_transfer" CHECK (fee_transaction_id <> transfer_transaction_id),
	CONSTRAINT "balance_transfers_promo_apr_range" CHECK (promo_apr >= 0 AND promo_apr <= 100)
);
--> statement-breakpoint
ALTER TABLE "balance_transfers" ADD CONSTRAINT "balance_transfers_transfer_transaction_id_fkey" FOREIGN KEY ("transfer_transaction_id") REFERENCES "public"."transactions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_transfers" ADD CONSTRAINT "balance_transfers_fee_transaction_id_fkey" FOREIGN KEY ("fee_transaction_id") REFERENCES "public"."transactions"("transaction_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- ==============================================
-- Hand-authored (Issue #417). Everything below this line is not generated:
-- drizzle-kit does not model triggers or comments (docs/schema-changes.md
-- step 4), and the drift gate cannot see it, so the audit trigger is proven by
-- tests/integration/actions/audit.test.ts instead.
--
-- balance_transfers annotates a transfer's posting on the receiving card with
-- the two facts the ledger cannot know: the promo end date and the promo APR.
-- Everything else about the transfer (card, amount, source, start date) is read
-- from the posting at query time. A promo is active on [posting date,
-- promo_end_date).
--
-- The posting FK is RESTRICT: deleting a linked posting would leave a transfer
-- with no card, amount or start date. The fee FK is SET NULL: the fee is an
-- ordinary expense, and deleting it only unlinks it. SET NULL is a row UPDATE
-- here, so the audit trigger records the unlink.
--
-- Adding the two FKs takes SHARE ROW EXCLUSIVE on transactions. If this
-- migration hangs, check pg_stat_activity for an idle-in-transaction session
-- holding a lock on transactions.
--
-- Grants: finance_app is covered by the default privileges, finance_bi is
-- granted in init-db/roles/02-grants.sql, and finance_importer gets nothing.
--
-- Backward-compatible: a new table the previous app version never reads. If
-- that version deletes a linked fee, ON DELETE SET NULL handles it; if it
-- deletes a linked posting, the delete fails safely with its generic message.
-- ==============================================
CREATE TRIGGER audit_balance_transfers
    AFTER INSERT OR UPDATE OR DELETE ON "balance_transfers"
    FOR EACH ROW EXECUTE FUNCTION audit_row_change('balance_transfer_id');--> statement-breakpoint
COMMENT ON TABLE "balance_transfers" IS 'One row per balance transfer (Issue #417): the promo terms for a posting on the receiving card. Card, amount, source and start date are read from the posting. Active on [posting date, promo_end_date). See docs/database.md.';--> statement-breakpoint
COMMENT ON COLUMN "balance_transfers"."transfer_transaction_id" IS 'The transfer''s leg on the receiving card: negative amount, related_account_id = the source card (NULL when untracked). RESTRICT: remove the transfer before deleting this posting.';--> statement-breakpoint
COMMENT ON COLUMN "balance_transfers"."fee_transaction_id" IS 'The fee as it posted: an ordinary expense on the same card. NULL when there was no separate fee. SET NULL when the fee transaction is deleted.';
