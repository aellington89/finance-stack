-- Backfill any empty strings before enforcing non-blank. `<> ''` mirrors the app's
-- z.string().min(1); whitespace-only is deferred to the validation audit (#179).
-- Both UPDATEs are idempotent: a re-run matches no rows.
UPDATE "accounts" SET "account_name" = '(unnamed account)' WHERE "account_name" = '';--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_name_not_blank" CHECK (account_name <> '');--> statement-breakpoint
UPDATE "transactions" SET "transaction_description" = '(no description)' WHERE "transaction_description" = '';--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transaction_description_not_blank" CHECK (transaction_description <> '');
