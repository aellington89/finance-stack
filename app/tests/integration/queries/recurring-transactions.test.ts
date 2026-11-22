import { describe, it, expect, afterEach } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, recurringTransactions } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { getRecurringToday, getRecurringTransactions } from "@/lib/queries/recurring-transactions";
import { currentDate } from "@/lib/recurring/materialize";

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
  await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
  createdAccountIds.length = 0;
});

describe("getRecurringTransactions (AC16)", () => {
  it("joins the names and carries the stored fields", async () => {
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
        anchorDate: "2030-05-29",
        nextRunDate: "2030-06-12",
        endDate: "2030-12-31",
      })
      .returning({ id: recurringTransactions.recurringTransactionId });

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
      anchorDate: "2030-05-29",
      nextRunDate: "2030-06-12",
      endDate: "2030-12-31",
      isActive: true,
    });
  });

  it("lists the templates that still run first, then the Ended and paused ones, each by next date", async () => {
    const accountId = await createAccount("Recurring query: order");
    const closedId = await createAccount("Recurring query: closed", "2020-01-01");
    const insert = (values: {
      nextRunDate: string;
      anchorDate?: string;
      endDate?: string;
      isActive?: boolean;
      accountId?: number;
    }) =>
      db
        .insert(recurringTransactions)
        .values({
          transactionDescription: "Order",
          amount: "-1.00",
          accountId: values.accountId ?? accountId,
          transactionTypeId: 1,
          transactionCategoryId: 1,
          cadence: "monthly",
          anchorDate: values.anchorDate ?? values.nextRunDate,
          nextRunDate: values.nextRunDate,
          endDate: values.endDate ?? null,
          isActive: values.isActive ?? true,
        })
        .returning({ id: recurringTransactions.recurringTransactionId })
        .then((r) => r[0].id);

    const late = await insert({ nextRunDate: "2031-03-01" });
    const paused = await insert({ nextRunDate: "2031-01-01", isActive: false, accountId: closedId });
    const early = await insert({ nextRunDate: "2031-02-01" });
    // Still active, but its next date is past its end: Ended.
    const ended = await insert({ anchorDate: "2031-01-01", nextRunDate: "2031-02-01", endDate: "2031-01-15" });

    const ids = [late, paused, early, ended];
    const rows = (await getRecurringTransactions()).filter((r) => ids.includes(r.recurringTransactionId));

    expect(rows.map((r) => r.recurringTransactionId)).toEqual([early, late, paused, ended]);
    expect(rows[2]).toMatchObject({
      isActive: false,
      accountClosedDate: "2020-01-01",
      relatedAccountId: null,
      relatedAccountName: null,
    });
    expect(rows[3]).toMatchObject({ isActive: true, nextRunDate: "2031-02-01", endDate: "2031-01-15" });
  });
});

describe("getRecurringToday", () => {
  it("is the save's today, and the instant that day ends in the database's time zone", async () => {
    const { today, endsAt } = await getRecurringToday();
    expect(today).toBe(await currentDate());

    const expected = await db.execute<{ ends_at: string }>(
      sql`SELECT ((CURRENT_DATE + 1)::timestamptz)::text AS ends_at`
    );
    const now = Date.now();
    expect(endsAt).toBe(new Date(expected.rows[0].ends_at.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).getTime());
    expect(endsAt).toBeGreaterThan(now);
    // At most a day and a DST hour ahead.
    expect(endsAt - now).toBeLessThanOrEqual(25 * 3_600_000);
  });
});
