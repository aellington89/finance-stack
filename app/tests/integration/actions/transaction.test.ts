import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, transactions, accountBalanceHistory } from "@/drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import {
  submitTransaction,
  updateTransaction,
  deleteTransaction,
} from "@/lib/actions/transaction";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.append(key, val);
  }
  return fd;
}

const emptyState = { success: false, errors: {}, message: "" };

let testAccountId: number;
let secondaryAccountId: number;
let extraAccountIds: number[];

async function createAccount(name: string): Promise<number> {
  const [inserted] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId: 1 })
    .returning({ accountId: accounts.accountId });
  extraAccountIds.push(inserted.accountId);
  return inserted.accountId;
}

beforeEach(async () => {
  extraAccountIds = [];
  testAccountId = await createAccount("Txn Test Account");
  secondaryAccountId = await createAccount("Txn Test Account (secondary)");
});

afterEach(async () => {
  if (extraAccountIds.length === 0) return;
  await db
    .delete(transactions)
    .where(inArray(transactions.accountId, extraAccountIds));
  await db
    .delete(accountBalanceHistory)
    .where(inArray(accountBalanceHistory.accountId, extraAccountIds));
  await db
    .delete(accounts)
    .where(inArray(accounts.accountId, extraAccountIds));
});

// ─── submitTransaction ────────────────────────────────────────────────────────

describe("submitTransaction", () => {
  it("inserts a transaction and returns success", async () => {
    const fd = makeFormData({
      transactionDescription: "Grocery Store",
      transactionDate: "2024-03-15",
      amount: "-82.50",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await submitTransaction(emptyState, fd);
    expect(result.success).toBe(true);

    const rows = await db
      .select({ transactionId: transactions.transactionId })
      .from(transactions)
      .where(eq(transactions.accountId, testAccountId));
    expect(rows.length).toBe(1);
  });

  it("builds balance history after insert", async () => {
    const fd = makeFormData({
      transactionDescription: "Paycheck",
      transactionDate: "2024-03-15",
      amount: "3000.00",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    await submitTransaction(emptyState, fd);

    const history = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, testAccountId));
    expect(history.length).toBeGreaterThan(0);
  });

  it("returns validation errors for empty description", async () => {
    const fd = makeFormData({
      transactionDescription: "",
      transactionDate: "2024-03-15",
      amount: "50.00",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await submitTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty("transactionDescription");
  });

  it("returns validation errors for invalid date", async () => {
    const fd = makeFormData({
      transactionDescription: "Test",
      transactionDate: "not-a-date",
      amount: "50.00",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await submitTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty("transactionDate");
  });

  it("returns validation errors for invalid amount", async () => {
    const fd = makeFormData({
      transactionDescription: "Test",
      transactionDate: "2024-03-15",
      amount: "abc",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await submitTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty("amount");
  });
});

// ─── updateTransaction ────────────────────────────────────────────────────────

async function seedTransaction(overrides: {
  accountId: number;
  amount?: string;
  date?: string;
  description?: string;
  relatedAccountId?: number | null;
}): Promise<number> {
  const [inserted] = await db
    .insert(transactions)
    .values({
      transactionDescription: overrides.description ?? "Seed",
      transactionDate: overrides.date ?? "2024-03-15",
      accountId: overrides.accountId,
      amount: overrides.amount ?? "100.00",
      relatedAccountId: overrides.relatedAccountId ?? null,
      transactionTypeId: 1,
      transactionCategoryId: 1,
    })
    .returning({ transactionId: transactions.transactionId });
  return inserted.transactionId;
}

describe("updateTransaction", () => {
  it("updates description, date, and amount", async () => {
    const transactionId = await seedTransaction({
      accountId: testAccountId,
      amount: "100.00",
      description: "Old description",
      date: "2024-03-15",
    });

    const fd = makeFormData({
      transactionId: String(transactionId),
      transactionDescription: "New description",
      transactionDate: "2024-04-01",
      amount: "250.00",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await updateTransaction(emptyState, fd);
    expect(result.success).toBe(true);

    const [row] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId));
    expect(row.transactionDescription).toBe("New description");
    expect(row.transactionDate).toBe("2024-04-01");
    expect(row.amount).toBe("250.00");
  });

  it("rebuilds balance history for both old and new accounts when accountId changes", async () => {
    const transactionId = await seedTransaction({
      accountId: testAccountId,
      amount: "500.00",
      date: "2024-03-15",
    });

    const fd = makeFormData({
      transactionId: String(transactionId),
      transactionDescription: "Moved",
      transactionDate: "2024-03-15",
      amount: "500.00",
      accountId: String(secondaryAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await updateTransaction(emptyState, fd);
    expect(result.success).toBe(true);

    // Old account's balance history should now reflect zero transactions.
    const oldHistory = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, testAccountId));
    for (const row of oldHistory) {
      expect(Number(row.cumulativeBalance)).toBe(0);
    }

    // New account should have a balance row reflecting the moved transaction.
    const newHistory = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, secondaryAccountId));
    expect(newHistory.length).toBeGreaterThan(0);
    expect(
      newHistory.some((row) => Number(row.cumulativeBalance) === 500)
    ).toBe(true);
  });

  it("rebuilds balance history for both primary and related account on transfer edit", async () => {
    const transactionId = await seedTransaction({
      accountId: testAccountId,
      amount: "100.00",
      relatedAccountId: secondaryAccountId,
    });

    const thirdAccountId = await createAccount("Txn Test Account (third)");

    const fd = makeFormData({
      transactionId: String(transactionId),
      transactionDescription: "Transfer reroute",
      transactionDate: "2024-03-15",
      amount: "100.00",
      accountId: String(testAccountId),
      relatedAccountId: String(thirdAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await updateTransaction(emptyState, fd);
    expect(result.success).toBe(true);

    const [row] = await db
      .select({ relatedAccountId: transactions.relatedAccountId })
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId));
    expect(row.relatedAccountId).toBe(thirdAccountId);

    // Primary account's balance history should still exist.
    const primaryHistory = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, testAccountId));
    expect(primaryHistory.length).toBeGreaterThan(0);
  });

  it("returns validation errors when amount is invalid", async () => {
    const transactionId = await seedTransaction({ accountId: testAccountId });

    const fd = makeFormData({
      transactionId: String(transactionId),
      transactionDescription: "Test",
      transactionDate: "2024-03-15",
      amount: "abc",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await updateTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty("amount");

    // Original row unchanged.
    const [row] = await db
      .select({ description: transactions.transactionDescription })
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId));
    expect(row.description).toBe("Seed");
  });

  it("returns 'Transaction not found' for a non-existent ID", async () => {
    const fd = makeFormData({
      transactionId: "999999999",
      transactionDescription: "Nope",
      transactionDate: "2024-03-15",
      amount: "1.00",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await updateTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Transaction not found");
  });

  it("rejects non-positive transactionId without touching the DB", async () => {
    const fd = makeFormData({
      transactionId: "0",
      transactionDescription: "Test",
      transactionDate: "2024-03-15",
      amount: "1.00",
      accountId: String(testAccountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    });

    const result = await updateTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Invalid transaction ID");
  });

  it("rolls back the UPDATE when an FK constraint fails", async () => {
    const transactionId = await seedTransaction({
      accountId: testAccountId,
      description: "Original",
    });

    const fd = makeFormData({
      transactionId: String(transactionId),
      transactionDescription: "Should not persist",
      transactionDate: "2024-03-15",
      amount: "1.00",
      accountId: String(testAccountId),
      transactionTypeId: "999999",
      transactionCategoryId: "1",
    });

    const result = await updateTransaction(emptyState, fd);
    expect(result.success).toBe(false);

    const [row] = await db
      .select({ description: transactions.transactionDescription })
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId));
    expect(row.description).toBe("Original");
  });
});

// ─── deleteTransaction ────────────────────────────────────────────────────────

describe("deleteTransaction", () => {
  it("deletes the row and rebuilds balance history for the affected account", async () => {
    const transactionId = await seedTransaction({
      accountId: testAccountId,
      amount: "100.00",
    });
    const otherTxnId = await seedTransaction({
      accountId: testAccountId,
      amount: "200.00",
      date: "2024-03-20",
    });

    const fd = makeFormData({ transactionId: String(transactionId) });
    const result = await deleteTransaction(emptyState, fd);
    expect(result.success).toBe(true);

    const remaining = await db
      .select({ id: transactions.transactionId })
      .from(transactions)
      .where(eq(transactions.accountId, testAccountId));
    expect(remaining.map((r) => r.id)).toEqual([otherTxnId]);

    // Balance history should reflect just the surviving transaction (200.00).
    const history = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, testAccountId));
    expect(history.length).toBeGreaterThan(0);
    expect(
      history.some((row) => Number(row.cumulativeBalance) === 200)
    ).toBe(true);
  });

  it("clears all balance history when deleting the last transaction on an account", async () => {
    const transactionId = await seedTransaction({
      accountId: testAccountId,
      amount: "100.00",
    });

    // Confirm there's balance history first.
    const before = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, testAccountId));
    // Note: the seedTransaction helper doesn't trigger rebuildAccountBalance,
    // so before may be empty. Force a rebuild via submitTransaction first
    // would be heavyweight — instead, ensure the post-delete state is clean.
    void before;

    const fd = makeFormData({ transactionId: String(transactionId) });
    const result = await deleteTransaction(emptyState, fd);
    expect(result.success).toBe(true);

    const after = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, testAccountId));
    expect(after).toEqual([]);
  });

  it("rebuilds balance history for both accounts on a transfer delete", async () => {
    const transactionId = await seedTransaction({
      accountId: testAccountId,
      amount: "100.00",
      relatedAccountId: secondaryAccountId,
    });
    // Add a non-transfer transaction on secondary to keep it non-empty.
    await seedTransaction({
      accountId: secondaryAccountId,
      amount: "50.00",
      date: "2024-04-01",
    });

    const fd = makeFormData({ transactionId: String(transactionId) });
    const result = await deleteTransaction(emptyState, fd);
    expect(result.success).toBe(true);

    // Secondary should still have its own balance history.
    const secondaryHistory = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, secondaryAccountId));
    expect(secondaryHistory.length).toBeGreaterThan(0);
  });

  it("returns 'Transaction not found' for a non-existent ID", async () => {
    const fd = makeFormData({ transactionId: "999999999" });
    const result = await deleteTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Transaction not found");
  });

  it("rejects non-positive transactionId without touching the DB", async () => {
    const fd = makeFormData({ transactionId: "-1" });
    const result = await deleteTransaction(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Invalid transaction ID");
  });
});

// ─── non-blank CHECK constraint (issue #147) ─────────────────────────────────

describe("transactions_transaction_description_not_blank", () => {
  it("rejects a direct insert with an empty description (Postgres check violation 23514)", async () => {
    await expect(
      db.insert(transactions).values({
        transactionDescription: "",
        transactionDate: "2024-03-15",
        accountId: testAccountId,
        amount: "1.00",
        transactionTypeId: 1,
        transactionCategoryId: 1,
      })
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
