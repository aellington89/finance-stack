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

// Seed required reference/lookup data before each test file.
// TRUNCATE ... RESTART IDENTITY CASCADE resets sequences so IDs start at 1,
// ensuring the hardcoded ID 1 used throughout the tests is always valid.
beforeAll(async () => {
  await db.execute(
    sql`TRUNCATE TABLE account_type_categories RESTART IDENTITY CASCADE`
  );
  await db.execute(
    sql`TRUNCATE TABLE transaction_categories RESTART IDENTITY CASCADE`
  );
  await db.execute(
    sql`TRUNCATE TABLE transaction_types RESTART IDENTITY CASCADE`
  );

  await db.execute(
    sql`INSERT INTO account_type_categories (account_type_category) VALUES ('Asset')`
  );
  await db.execute(
    sql`INSERT INTO account_types (account_type, account_type_category_id) VALUES ('Checking', 1)`
  );
  await db.execute(
    sql`INSERT INTO transaction_categories (transaction_category_id, transaction_category) OVERRIDING SYSTEM VALUE VALUES (1, 'General'), (6, 'Other') ON CONFLICT DO NOTHING`
  );
  await db.execute(
    sql`INSERT INTO transaction_types (transaction_type_id, transaction_type) OVERRIDING SYSTEM VALUE VALUES (1, 'Expense'), (12, 'Opening Balance') ON CONFLICT DO NOTHING`
  );
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('transaction_categories', 'transaction_category_id'), (SELECT MAX(transaction_category_id) FROM transaction_categories))`
  );
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('transaction_types', 'transaction_type_id'), (SELECT MAX(transaction_type_id) FROM transaction_types))`
  );
});
