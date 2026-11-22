import { describe, it, expect, afterEach } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountBalanceHistory, accounts, recurringTransactions, transactions } from "@/drizzle/schema";
import { getRecurringTransactions } from "@/lib/queries/recurring-transactions";
import { runDueTemplates } from "@/lib/recurring/materialize";

// The Recurring tab's read (Issue #135).

const createdAccountIds: number[] = [];

async function createAccount(name: string, closedDate: string | null = null): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId: 1, closedDate })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

afterEach(async () => {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.accountId, createdAccountIds));
  await db.delete(transactions).where(inArray(transactions.accountId, createdAccountIds));
  await db.delete(accountBalanceHistory).where(inArray(accountBalanceHistory.accountId, createdAccountIds));
  await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
  createdAccountIds.length = 0;
});

describe("getRecurringTransactions (AC16)", () => {
  it("joins the names, carries the stored fields, and finds the last created date", async () => {
    const accountId = await createAccount("Recurring query: checking");
    const relatedId = await createAccount("Recurring query: savings", "2030-01-01");
    const [{ id }] = await db
      .insert(recurringTransactions)
      .values({
        transactionDescription: "Query template",
        amount: "-1450.00",
        accountId,
        relatedAccountId: relatedId,
        transactionTypeId: 1,
        transactionCategoryId: 1,
        cadence: "weekly",
        intervalCount: 2,
        anchorDate: "2020-05-29",
        nextRunDate: "2020-05-29",
        endDate: "2020-12-31",
      })
      .returning({ id: recurringTransactions.recurringTransactionId });
    await runDueTemplates({ today: "2020-06-12" });

    const row = (await getRecurringTransactions()).find((r) => r.recurringTransactionId === id);

    expect(row).toEqual({
      recurringTransactionId: id,
      transactionDescription: "Query template",
      amount: "-1450.00",
      accountId,
      accountName: "Recurring query: checking",
      accountClosedDate: null,
      relatedAccountId: relatedId,
      relatedAccountName: "Recurring query: savings",
      transactionTypeId: 1,
      transactionType: expect.any(String),
      transactionCategoryId: 1,
      transactionCategory: expect.any(String),
      cadence: "weekly",
      intervalCount: 2,
      anchorDate: "2020-05-29",
      nextRunDate: "2020-06-26",
      endDate: "2020-12-31",
      isActive: true,
      lastCreatedOn: "2020-06-12",
    });
  });

  it("lists active templates first, then by next date, and reports a closed account", async () => {
    const accountId = await createAccount("Recurring query: order");
    const closedId = await createAccount("Recurring query: closed", "2020-01-01");
    const insert = (values: { nextRunDate: string; isActive?: boolean; accountId?: number }) =>
      db
        .insert(recurringTransactions)
        .values({
          transactionDescription: "Order",
          amount: "-1.00",
          accountId: values.accountId ?? accountId,
          transactionTypeId: 1,
          transactionCategoryId: 1,
          cadence: "monthly",
          anchorDate: values.nextRunDate,
          nextRunDate: values.nextRunDate,
          isActive: values.isActive ?? true,
        })
        .returning({ id: recurringTransactions.recurringTransactionId })
        .then((r) => r[0].id);

    const late = await insert({ nextRunDate: "2031-03-01" });
    const paused = await insert({ nextRunDate: "2031-01-01", isActive: false, accountId: closedId });
    const early = await insert({ nextRunDate: "2031-02-01" });

    const rows = (await getRecurringTransactions()).filter((r) => [late, paused, early].includes(r.recurringTransactionId));

    expect(rows.map((r) => r.recurringTransactionId)).toEqual([early, late, paused]);
    expect(rows[2]).toMatchObject({
      isActive: false,
      accountClosedDate: "2020-01-01",
      relatedAccountId: null,
      relatedAccountName: null,
      lastCreatedOn: null,
    });
  });
});
