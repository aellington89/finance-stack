import { describe, it, expect, afterEach } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountBalanceHistory,
  accounts,
  recurringTransactions,
  transactions,
} from "@/drizzle/schema";

/**
 * Recurring transactions against Postgres (Issue #135). "Today" is a 2020
 * date, so every row sits outside the seeded mock-data window, and the tests
 * don't depend on what day they run on. Each test makes its own accounts and
 * templates.
 */

const TODAY = "2020-06-10";

type Cadence = "daily" | "weekly" | "monthly" | "yearly";

const createdAccountIds: number[] = [];

async function createAccount(name: string, closedDate: string | null = null): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId: 1, closedDate })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

interface TemplateInput {
  accountId: number;
  relatedAccountId?: number | null;
  cadence?: Cadence;
  every?: number;
  anchorDate: string;
  nextRunDate?: string;
  endDate?: string | null;
  isActive?: boolean;
  amount?: string;
}

async function createTemplate(input: TemplateInput): Promise<number> {
  const [row] = await db
    .insert(recurringTransactions)
    .values({
      transactionDescription: "Recurring test",
      amount: input.amount ?? "-25.00",
      accountId: input.accountId,
      relatedAccountId: input.relatedAccountId ?? null,
      transactionTypeId: 1,
      transactionCategoryId: 1,
      cadence: input.cadence ?? "daily",
      intervalCount: input.every ?? 1,
      anchorDate: input.anchorDate,
      nextRunDate: input.nextRunDate ?? input.anchorDate,
      endDate: input.endDate ?? null,
      isActive: input.isActive ?? true,
    })
    .returning({ id: recurringTransactions.recurringTransactionId });
  return row.id;
}

async function createdRows(templateId: number) {
  return db
    .select({ transactionId: transactions.transactionId })
    .from(transactions)
    .where(eq(transactions.recurringTransactionId, templateId))
    .orderBy(asc(transactions.recurringOccurrenceDate));
}

afterEach(async () => {
  if (createdAccountIds.length === 0) return;
  // Templates first: their account FKs are RESTRICT.
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.accountId, createdAccountIds));
  await db.delete(transactions).where(inArray(transactions.accountId, createdAccountIds));
  await db.delete(accountBalanceHistory).where(inArray(accountBalanceHistory.accountId, createdAccountIds));
  await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
  createdAccountIds.length = 0;
});

describe("the link pair's constraints", () => {
  it("rejects a second row for the same occurrence", async () => {
    const accountId = await createAccount("Recurring: unique");
    const id = await createTemplate({ accountId, anchorDate: TODAY });
    const row = {
      transactionDescription: "Occurrence",
      transactionDate: TODAY,
      accountId,
      amount: "-1.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
      recurringTransactionId: id,
      recurringOccurrenceDate: TODAY,
    };
    await db.insert(transactions).values(row);
    await expect(db.insert(transactions).values(row)).rejects.toMatchObject({
      cause: { code: "23505", constraint: "transactions_recurring_occurrence_key" },
    });
    expect(await createdRows(id)).toHaveLength(1);
  });

  it("allows any number of hand-entered rows (both columns NULL)", async () => {
    const accountId = await createAccount("Recurring: nulls distinct");
    const row = {
      transactionDescription: "By hand",
      transactionDate: TODAY,
      accountId,
      amount: "-1.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
    };
    await db.insert(transactions).values([row, row]);
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, accountId));
    expect(rows).toHaveLength(2);
  });

  it("rejects a link with no occurrence date, and the reverse", async () => {
    const accountId = await createAccount("Recurring: pair");
    const base = {
      transactionDescription: "Half a link",
      transactionDate: TODAY,
      accountId,
      amount: "-1.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
    };
    await expect(db.insert(transactions).values({ ...base, recurringTransactionId: 1 })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "transactions_recurring_link_pair" },
    });
    await expect(db.insert(transactions).values({ ...base, recurringOccurrenceDate: TODAY })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "transactions_recurring_link_pair" },
    });
  });

  it("enforces the template CHECKs", async () => {
    const accountId = await createAccount("Recurring: checks");
    const relatedId = await createAccount("Recurring: checks (other)");
    const bad: Array<[Partial<TemplateInput> & { cadence?: string }, string]> = [
      [{ cadence: "hourly" as Cadence }, "recurring_transactions_cadence_check"],
      [{ every: 0 }, "recurring_transactions_interval_count_range"],
      [{ every: 100 }, "recurring_transactions_interval_count_range"],
      [{ nextRunDate: "2020-06-09" }, "recurring_transactions_next_not_before_anchor"],
      [{ endDate: "2020-06-09" }, "recurring_transactions_end_not_before_anchor"],
      [{ relatedAccountId: accountId }, "recurring_transactions_related_differs"],
    ];
    for (const [overrides, constraint] of bad) {
      await expect(createTemplate({ accountId, anchorDate: TODAY, ...overrides } as TemplateInput)).rejects.toMatchObject({
        cause: { code: "23514", constraint },
      });
    }
    // A related account that differs is fine.
    await createTemplate({ accountId, relatedAccountId: relatedId, anchorDate: TODAY });
  });

  it("refuses to delete an account a template uses (RESTRICT)", async () => {
    const accountId = await createAccount("Recurring: restrict");
    await createTemplate({ accountId, anchorDate: "2030-01-01" });
    await expect(db.delete(accounts).where(eq(accounts.accountId, accountId))).rejects.toMatchObject({
      cause: { code: "23001", constraint: "recurring_transactions_account_id_fkey" },
    });
  });
});
