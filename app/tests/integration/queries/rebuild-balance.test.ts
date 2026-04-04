import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, accountBalanceHistory } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { ensureTodayBalances } from "@/lib/queries/rebuild-balance";

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

// Track account IDs created during tests so we can clean them up
const createdAccountIds: number[] = [];

afterEach(async () => {
  for (const id of createdAccountIds) {
    await db.delete(accountBalanceHistory).where(eq(accountBalanceHistory.accountId, id));
    await db.delete(accounts).where(eq(accounts.accountId, id));
  }
  createdAccountIds.length = 0;
});

describe("ensureTodayBalances", () => {
  it("creates a carry-forward row for today when none exists", async () => {
    // Create an open account with a historical balance row
    const [account] = await db
      .insert(accounts)
      .values({ accountName: "Carry Forward Test", accountTypeId: 1 })
      .returning({ accountId: accounts.accountId });
    createdAccountIds.push(account.accountId);

    await db.insert(accountBalanceHistory).values({
      accountId: account.accountId,
      balanceDate: yesterday,
      dailyBalance: "100.00",
      cumulativeBalance: "500.00",
    });

    await ensureTodayBalances();

    const rows = await db
      .select()
      .from(accountBalanceHistory)
      .where(
        and(
          eq(accountBalanceHistory.accountId, account.accountId),
          eq(accountBalanceHistory.balanceDate, today)
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].dailyBalance).toBe("0.00");
    expect(rows[0].cumulativeBalance).toBe("500.00");
  });

  it("is idempotent — calling twice does not duplicate or overwrite rows", async () => {
    const [account] = await db
      .insert(accounts)
      .values({ accountName: "Idempotent Test", accountTypeId: 1 })
      .returning({ accountId: accounts.accountId });
    createdAccountIds.push(account.accountId);

    await db.insert(accountBalanceHistory).values({
      accountId: account.accountId,
      balanceDate: yesterday,
      dailyBalance: "50.00",
      cumulativeBalance: "200.00",
    });

    await ensureTodayBalances();
    await ensureTodayBalances();

    const rows = await db
      .select()
      .from(accountBalanceHistory)
      .where(
        and(
          eq(accountBalanceHistory.accountId, account.accountId),
          eq(accountBalanceHistory.balanceDate, today)
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].cumulativeBalance).toBe("200.00");
  });

  it("does not overwrite an existing row for today", async () => {
    const [account] = await db
      .insert(accounts)
      .values({ accountName: "Existing Row Test", accountTypeId: 1 })
      .returning({ accountId: accounts.accountId });
    createdAccountIds.push(account.accountId);

    // Simulate a row created by rebuildAccountBalance (from a transaction today)
    await db.insert(accountBalanceHistory).values({
      accountId: account.accountId,
      balanceDate: today,
      dailyBalance: "75.00",
      cumulativeBalance: "1000.00",
    });

    await ensureTodayBalances();

    const rows = await db
      .select()
      .from(accountBalanceHistory)
      .where(
        and(
          eq(accountBalanceHistory.accountId, account.accountId),
          eq(accountBalanceHistory.balanceDate, today)
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].dailyBalance).toBe("75.00");
    expect(rows[0].cumulativeBalance).toBe("1000.00");
  });

  it("skips closed accounts", async () => {
    const [account] = await db
      .insert(accounts)
      .values({
        accountName: "Closed Account Test",
        accountTypeId: 1,
        closedDate: yesterday,
      })
      .returning({ accountId: accounts.accountId });
    createdAccountIds.push(account.accountId);

    await db.insert(accountBalanceHistory).values({
      accountId: account.accountId,
      balanceDate: yesterday,
      dailyBalance: "10.00",
      cumulativeBalance: "300.00",
    });

    await ensureTodayBalances();

    const rows = await db
      .select()
      .from(accountBalanceHistory)
      .where(
        and(
          eq(accountBalanceHistory.accountId, account.accountId),
          eq(accountBalanceHistory.balanceDate, today)
        )
      );

    expect(rows).toHaveLength(0);
  });

  it("defaults to 0 cumulative balance for accounts with no history", async () => {
    const [account] = await db
      .insert(accounts)
      .values({ accountName: "No History Test", accountTypeId: 1 })
      .returning({ accountId: accounts.accountId });
    createdAccountIds.push(account.accountId);

    await ensureTodayBalances();

    const rows = await db
      .select()
      .from(accountBalanceHistory)
      .where(
        and(
          eq(accountBalanceHistory.accountId, account.accountId),
          eq(accountBalanceHistory.balanceDate, today)
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].dailyBalance).toBe("0.00");
    expect(rows[0].cumulativeBalance).toBe("0.00");
  });
});
