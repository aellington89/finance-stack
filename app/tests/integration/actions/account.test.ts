import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, accountBalanceHistory, transactions } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

// Actions under test
import { createAccount, updateAccount, deleteAccount } from "@/lib/actions/account";

// Helpers to build FormData from a plain object
function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.append(key, val);
  }
  return fd;
}

const emptyState = { success: false, errors: {}, message: "" };

// Track account IDs created during tests so we can clean them up
const createdAccountIds: number[] = [];

afterEach(async () => {
  // Clean up any accounts (and their related rows) created during tests
  for (const id of createdAccountIds) {
    await db.delete(transactions).where(eq(transactions.accountId, id));
    await db.delete(accountBalanceHistory).where(eq(accountBalanceHistory.accountId, id));
    await db.delete(accounts).where(eq(accounts.accountId, id));
  }
  createdAccountIds.length = 0;
});

// ─── createAccount ────────────────────────────────────────────────────────────

describe("createAccount", () => {
  it("creates an account with valid minimal input", async () => {
    const fd = makeFormData({ accountName: "Test Checking", accountTypeId: "1" });
    const result = await createAccount(emptyState, fd);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/created/i);

    // Verify the row exists in the DB
    const rows = await db
      .select({ accountId: accounts.accountId })
      .from(accounts)
      .where(eq(accounts.accountName, "Test Checking"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    createdAccountIds.push(...rows.map((r) => r.accountId));
  });

  it("creates an account with an initial balance (produces balance history)", async () => {
    const fd = makeFormData({
      accountName: "Test Savings",
      accountTypeId: "1",
      openedDate: "2020-01-01",
      initialBalance: "5000.00",
    });
    const result = await createAccount(emptyState, fd);
    expect(result.success).toBe(true);

    const rows = await db
      .select({ accountId: accounts.accountId })
      .from(accounts)
      .where(eq(accounts.accountName, "Test Savings"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const accountId = rows[0].accountId;
    createdAccountIds.push(accountId);

    // Balance history should have been built
    const history = await db
      .select()
      .from(accountBalanceHistory)
      .where(eq(accountBalanceHistory.accountId, accountId));
    expect(history.length).toBeGreaterThan(0);
  });

  it("returns validation errors for empty account name", async () => {
    const fd = makeFormData({ accountName: "", accountTypeId: "1" });
    const result = await createAccount(emptyState, fd);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty("accountName");
  });

  // The DB backstop for the above (issue #147): even a direct insert bypassing
  // validation is rejected by the non-blank CHECK constraint (Postgres 23514).
  it("rejects a direct insert with an empty account name", async () => {
    await expect(
      db.insert(accounts).values({ accountName: "", accountTypeId: 1 })
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("returns error for invalid accountTypeId", async () => {
    const fd = makeFormData({ accountName: "Test", accountTypeId: "0" });
    const result = await createAccount(emptyState, fd);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty("accountTypeId");
  });

  it("persists liquidityClass when explicitly provided (override)", async () => {
    const fd = makeFormData({
      accountName: "Liq Override",
      accountTypeId: "1",
      liquidityClass: "illiquid",
    });
    const result = await createAccount(emptyState, fd);
    expect(result.success).toBe(true);

    const rows = await db
      .select({
        accountId: accounts.accountId,
        liquidityClass: accounts.liquidityClass,
      })
      .from(accounts)
      .where(eq(accounts.accountName, "Liq Override"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].liquidityClass).toBe("illiquid");
    createdAccountIds.push(...rows.map((r) => r.accountId));
  });

  it("stores null when liquidityClass is omitted (inherits from type)", async () => {
    const fd = makeFormData({
      accountName: "Liq Inherit",
      accountTypeId: "1",
    });
    const result = await createAccount(emptyState, fd);
    expect(result.success).toBe(true);

    const rows = await db
      .select({
        accountId: accounts.accountId,
        liquidityClass: accounts.liquidityClass,
      })
      .from(accounts)
      .where(eq(accounts.accountName, "Liq Inherit"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].liquidityClass).toBeNull();
    createdAccountIds.push(...rows.map((r) => r.accountId));
  });
});

// ─── updateAccount ────────────────────────────────────────────────────────────

describe("updateAccount", () => {
  let testAccountId: number;

  beforeEach(async () => {
    const [inserted] = await db
      .insert(accounts)
      .values({ accountName: "Update Test", accountTypeId: 1 })
      .returning({ accountId: accounts.accountId });
    testAccountId = inserted.accountId;
    createdAccountIds.push(testAccountId);
  });

  it("updates account name successfully", async () => {
    const fd = makeFormData({
      accountId: String(testAccountId),
      accountName: "Renamed Account",
      accountTypeId: "1",
    });
    const result = await updateAccount(emptyState, fd);

    expect(result.success).toBe(true);

    const rows = await db
      .select({ accountName: accounts.accountName })
      .from(accounts)
      .where(eq(accounts.accountId, testAccountId));
    expect(rows[0].accountName).toBe("Renamed Account");
  });

  it("returns error for invalid (zero) accountId", async () => {
    const fd = makeFormData({
      accountId: "0",
      accountName: "Irrelevant",
      accountTypeId: "1",
    });
    const result = await updateAccount(emptyState, fd);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid/i);
  });

  it("returns validation errors for empty account name", async () => {
    const fd = makeFormData({
      accountId: String(testAccountId),
      accountName: "",
      accountTypeId: "1",
    });
    const result = await updateAccount(emptyState, fd);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty("accountName");
  });

  it("round-trips liquidityClass (null → set → change → null)", async () => {
    const readLiquidity = async () => {
      const rows = await db
        .select({ liquidityClass: accounts.liquidityClass })
        .from(accounts)
        .where(eq(accounts.accountId, testAccountId));
      return rows[0]?.liquidityClass ?? null;
    };

    // Initial state: null (inherit)
    expect(await readLiquidity()).toBeNull();

    // Set to 'illiquid'
    let result = await updateAccount(
      emptyState,
      makeFormData({
        accountId: String(testAccountId),
        accountName: "Update Test",
        accountTypeId: "1",
        liquidityClass: "illiquid",
      })
    );
    expect(result.success).toBe(true);
    expect(await readLiquidity()).toBe("illiquid");

    // Change to 'semi_liquid'
    result = await updateAccount(
      emptyState,
      makeFormData({
        accountId: String(testAccountId),
        accountName: "Update Test",
        accountTypeId: "1",
        liquidityClass: "semi_liquid",
      })
    );
    expect(result.success).toBe(true);
    expect(await readLiquidity()).toBe("semi_liquid");

    // Clear back to null (omitted → coerced to null by action)
    result = await updateAccount(
      emptyState,
      makeFormData({
        accountId: String(testAccountId),
        accountName: "Update Test",
        accountTypeId: "1",
      })
    );
    expect(result.success).toBe(true);
    expect(await readLiquidity()).toBeNull();
  });
});

// ─── deleteAccount ────────────────────────────────────────────────────────────

describe("deleteAccount", () => {
  it("deletes an account that has no transactions", async () => {
    const [inserted] = await db
      .insert(accounts)
      .values({ accountName: "Delete Me", accountTypeId: 1 })
      .returning({ accountId: accounts.accountId });
    const accountId = inserted.accountId;

    const fd = makeFormData({ accountId: String(accountId) });

    // deleteAccount calls redirect() on success — catch the redirect error
    try {
      await deleteAccount(emptyState, fd);
    } catch {
      // Next.js redirect() throws internally; this is expected on success
    }

    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.accountId, accountId));
    expect(rows.length).toBe(0);
  });

  it("blocks deletion when account has transactions", async () => {
    // We reference an existing seeded account that has transactions in the
    // Finances_Test DB. Account ID 1 is expected to exist from the seed data.
    // If it has transactions, deletion should be blocked.
    const [inserted] = await db
      .insert(accounts)
      .values({ accountName: "Has Transactions", accountTypeId: 1 })
      .returning({ accountId: accounts.accountId });
    const accountId = inserted.accountId;
    createdAccountIds.push(accountId);

    // Insert a transaction referencing this account to block deletion
    const [txn] = await db
      .insert(transactions)
      .values({
        transactionDescription: "Blocker",
        transactionDate: "2024-01-01",
        accountId,
        amount: "10.00",
        transactionTypeId: 1,
        transactionCategoryId: 1,
      })
      .returning({ transactionId: transactions.transactionId });

    const fd = makeFormData({ accountId: String(accountId) });
    const result = await deleteAccount(emptyState, fd);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/transactions/i);

    // Clean up transaction manually
    await db.delete(transactions).where(eq(transactions.transactionId, txn.transactionId));
  });

  it("returns error for invalid (zero) accountId", async () => {
    const fd = makeFormData({ accountId: "0" });
    const result = await deleteAccount(emptyState, fd);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid/i);
  });
});
