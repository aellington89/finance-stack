ALTER TABLE "transactions" ADD COLUMN "duplicated_from_transaction_id" integer;--> statement-breakpoint
-- ==============================================
-- Hand-authored (Issue #241); drizzle-kit does not model column comments (see
-- docs/schema-changes.md step 4).
--
-- Set by duplicateTransaction() in app/lib/actions/transaction.ts, NULL for
-- every other writer. audit_row_change() records to_jsonb(NEW), so the link
-- lands in the duplicate's INSERT audit row with no change to the trigger —
-- that row is the "audit trail shows the duplicate relationship" the issue
-- asks for.
--
-- No foreign key, on the same reasoning as audit_log.actor_user_id: this is
-- provenance, and "copied from #123" stays true after #123 is deleted. An FK
-- would have to either block deleting a transaction that has been copied
-- (NO ACTION) or rewrite every copy when it is (SET NULL, which also writes an
-- UPDATE audit row per copy and erases the live link). transaction_id is a
-- serial and is never reused, so a dangling value cannot name the wrong row;
-- the action checks the source exists at the time of the copy.
-- ==============================================
COMMENT ON COLUMN "transactions"."duplicated_from_transaction_id" IS 'The transaction this row was duplicated from (Issue #241). No FK by design: provenance survives the source being deleted. See docs/audit-log.md.';
