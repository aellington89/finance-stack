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

// Align the static lookup tables (account_type_categories, transaction_types)
// with the production Finances database — they drive core KPIs, so tests must
// exercise the same values the real app does. account_types and
// transaction_categories only need a minimum row (ID 1) to satisfy hardcoded
// test fixtures.
//
// Uses INSERT ... OVERRIDING SYSTEM VALUE ... ON CONFLICT DO UPDATE so the setup
// is idempotent and self-healing against drift from prior test runs or an
// out-of-date scripts/seed-test-data.sql. No TRUNCATE: the FK graph
// (account_types → account_type_categories, transactions → transaction_types /
// transaction_categories) makes non-CASCADE truncation impossible, and CASCADE
// would wipe seeded accounts/transactions/account_balance_history that other
// tests rely on.
beforeAll(async () => {
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
    INSERT INTO account_types (account_type_id, account_type, account_type_category_id)
    OVERRIDING SYSTEM VALUE VALUES
      (1, 'Cash & Cash Equivalent', 1)
    ON CONFLICT (account_type_id) DO UPDATE
      SET account_type = EXCLUDED.account_type,
          account_type_category_id = EXCLUDED.account_type_category_id
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
      (1, 'Credit Card Payment')
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
