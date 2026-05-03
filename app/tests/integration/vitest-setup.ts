import { vi, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// Mock Next.js server functions that require the Next.js runtime
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// Drift-correction for the static lookup tables. The init-db seed files
// (init-db/seeds/shared-lookups.sql + finances-test-mock-data.sql) populate
// everything on first Docker launch, but this beforeAll hook keeps tests
// self-healing: if a prior run mutated a lookup row, or an individual test
// file is executed against a Finances_Test DB that predates a lookup
// addition, the upserts below converge state back to the expected baseline.
//
// Uses INSERT ... OVERRIDING SYSTEM VALUE ... ON CONFLICT DO UPDATE so the
// setup is idempotent and safe to re-run. No TRUNCATE: the FK graph
// (account_types → account_type_categories, transactions → transaction_types /
// transaction_categories) makes non-CASCADE truncation impossible, and
// CASCADE would wipe seeded accounts/transactions/account_balance_history
// that other tests rely on.
beforeAll(async () => {
  // Ensure liquidity_class column exists before any upsert references it.
  // Safe for test DBs that predate the liquidity_class migration.
  await db.execute(sql`
    ALTER TABLE account_types
      ADD COLUMN IF NOT EXISTS liquidity_class text
      CHECK (liquidity_class IN ('liquid','semi_liquid','illiquid','restricted'))
  `);
  await db.execute(sql`
    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS liquidity_class text
      CHECK (liquidity_class IN ('liquid','semi_liquid','illiquid','restricted'))
  `);

  await db.execute(sql`
    INSERT INTO account_type_categories (account_type_category_id, account_type_category)
    OVERRIDING SYSTEM VALUE VALUES
      (1, 'Current Asset'),
      (2, 'Restricted Asset'),
      (3, 'Fixed Asset'),
      (4, 'Investment'),
      (5, 'Current Liability'),
      (6, 'Non-current Liability')
    ON CONFLICT (account_type_category_id) DO UPDATE
      SET account_type_category = EXCLUDED.account_type_category
  `);

  await db.execute(sql`
    INSERT INTO account_types (account_type_id, account_type, account_type_category_id, liquidity_class)
    OVERRIDING SYSTEM VALUE VALUES
      (1, 'Cash & Cash Equivalent', 1, 'liquid')
    ON CONFLICT (account_type_id) DO UPDATE
      SET account_type = EXCLUDED.account_type,
          account_type_category_id = EXCLUDED.account_type_category_id,
          liquidity_class = EXCLUDED.liquidity_class
  `);

  await db.execute(sql`
    INSERT INTO transaction_types (transaction_type_id, transaction_type)
    OVERRIDING SYSTEM VALUE VALUES
      (1, 'Internal Transfer'),
      (2, 'Expense'),
      (3, 'Refund'),
      (4, 'Income'),
      (5, 'Work Expense'),
      (6, 'Work Expense Reimbursement'),
      (7, 'Other'),
      (8, 'External Transfer'),
      (9, 'Accrued Amoritized Interest'),
      (10, 'Investment'),
      (11, 'Asset Re-Evaluation'),
      (12, 'Opening Balance')
    ON CONFLICT (transaction_type_id) DO UPDATE
      SET transaction_type = EXCLUDED.transaction_type
  `);

  await db.execute(sql`
    INSERT INTO transaction_categories (transaction_category_id, transaction_category)
    OVERRIDING SYSTEM VALUE VALUES
      (1,  'Credit Card Payment'),
      (2,  'HELOC Payment'),
      (3,  'Mortgage Payment'),
      (4,  'Student Loan Payment'),
      (6,  'Other'),
      (7,  'HELOC Principle'),
      (8,  'HELOC Interest'),
      (9,  'Accrued HELOC Interest'),
      (12, 'Mortgage Principle'),
      (13, 'Mortgage Interest'),
      (14, 'Accrued Mortgage Interest'),
      (29, 'Applied Credit'),
      (51, 'Interest Earned'),
      (54, 'Car Loan Payment'),
      (57, 'Epic Loan Interest'),
      (58, 'Epic Loan Payment'),
      (68, 'Auto Loan Interest'),
      (69, 'Accrued Auto Loan Interest'),
      (70, 'Auto Loan Principle'),
      (74, 'Accrued Student Loan Interest'),
      (75, 'Student Loan Principle'),
      (76, 'Student Loan Interest'),
      (79, 'Balance Transfer Payment Expense'),
      (80, 'Credit Card Interest')
    ON CONFLICT (transaction_category_id) DO UPDATE
      SET transaction_category = EXCLUDED.transaction_category
  `);

  // Advance the IDENTITY sequences past the highest explicit ID so subsequent
  // auto-generated inserts do not collide with the values seeded above.
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('account_type_categories', 'account_type_category_id'), (SELECT MAX(account_type_category_id) FROM account_type_categories))`
  );
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('account_types', 'account_type_id'), (SELECT MAX(account_type_id) FROM account_types))`
  );
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('transaction_types', 'transaction_type_id'), (SELECT MAX(transaction_type_id) FROM transaction_types))`
  );
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('transaction_categories', 'transaction_category_id'), (SELECT MAX(transaction_category_id) FROM transaction_categories))`
  );
});
