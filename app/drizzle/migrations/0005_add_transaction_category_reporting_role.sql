ALTER TABLE "transaction_categories" ADD COLUMN "reporting_role" text;--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_reporting_role_check" CHECK (reporting_role = ANY (ARRAY['debt_principle_paid'::text, 'debt_interest_paid'::text, 'debt_interest_accrued'::text, 'debt_cash_paydown'::text]));--> statement-breakpoint
-- ==============================================
-- Backfill (issue #111) — hand-authored; drizzle-kit does not model data
-- migrations (see docs/schema-changes.md step 4).
--
-- Before this migration the Liabilities drilldown identified debt activity by
-- a hard-coded list of transaction_category_id values in
-- app/lib/queries/liability-categories.ts. Those rows are the user's and ship
-- nowhere, so this restores the exact same aggregate membership on an install
-- that has them, and tags nothing on one that does not.
--
-- Matched on id AND name together, the same self-limiting rule the row
-- protection added in issue #109 uses. Locking on the id alone would tag
-- whatever unrelated category happens to occupy id 7 on somebody else's
-- database; requiring the name means a fresh install matches none of them, and
-- correctly ends up with every reporting_role NULL.
--
-- `reporting_role IS NULL` makes it re-runnable, and keeps a deliberate
-- retag by the user from being reverted if this ever runs twice. This
-- deliberately lives in the migration rather than in
-- init-db/seeds/shared-lookups.sql: that file is re-applied on every
-- `docker compose up`, where an IS NULL guard would silently put a role back
-- on a category the user had cleared.
-- ==============================================
UPDATE transaction_categories SET reporting_role = 'debt_principle_paid'
  WHERE reporting_role IS NULL
    AND (transaction_category_id, transaction_category) IN (
      (7,  'HELOC Principle'),
      (12, 'Mortgage Principle'),
      (70, 'Auto Loan Principle'),
      (75, 'Student Loan Principle')
    );--> statement-breakpoint
UPDATE transaction_categories SET reporting_role = 'debt_interest_paid'
  WHERE reporting_role IS NULL
    AND (transaction_category_id, transaction_category) IN (
      (8,  'HELOC Interest'),
      (13, 'Mortgage Interest'),
      (57, 'Epic Loan Interest'),
      (68, 'Auto Loan Interest'),
      (76, 'Student Loan Interest')
    );--> statement-breakpoint
-- Credit cards do not split into accrued and paid the way installment loans
-- do — the finance charge is the accrual — so 'Credit Card Interest' belongs
-- here rather than with the paid interest above.
UPDATE transaction_categories SET reporting_role = 'debt_interest_accrued'
  WHERE reporting_role IS NULL
    AND (transaction_category_id, transaction_category) IN (
      (9,  'Accrued HELOC Interest'),
      (14, 'Accrued Mortgage Interest'),
      (69, 'Accrued Auto Loan Interest'),
      (74, 'Accrued Student Loan Interest'),
      (80, 'Credit Card Interest')
    );--> statement-breakpoint
-- A credit-card paydown posts as one amount against the liability with no
-- principal/interest split of its own.
UPDATE transaction_categories SET reporting_role = 'debt_cash_paydown'
  WHERE reporting_role IS NULL
    AND (transaction_category_id, transaction_category) IN (
      (29, 'Applied Credit')
    );
