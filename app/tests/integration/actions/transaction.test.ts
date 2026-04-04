import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, transactions, accountBalanceHistory } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { submitTransaction } from "@/lib/actions/transaction";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.append(key, val);
  }
  return fd;
}

const emptyState = { success: false, errors: {}, message: "" };

let testAccountId: number;

beforeEach(async () => {
  const [inserted] = await db
    .insert(accounts)
    .values({ accountName: "Txn Test Account", accountTypeId: 1 })
    .returning({ accountId: accounts.accountId });
  testAccountId = inserted.accountId;
});

afterEach(async () => {
  // Remove transactions referencing the test account, then the account itself
  await db
    .delete(transactions)
    .where(eq(transactions.accountId, testAccountId));
  await db
    .delete(accountBalanceHistory)
    .where(eq(accountBalanceHistory.accountId, testAccountId));
  await db.delete(accounts).where(eq(accounts.accountId, testAccountId));
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
