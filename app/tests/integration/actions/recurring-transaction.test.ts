import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountBalanceHistory,
  accounts,
  auditLog,
  recurringTransactions,
  transactionCategories,
  transactionTypes,
  transactions,
} from "@/drizzle/schema";
import {
  createRecurringTransaction,
  deleteRecurringTransaction,
  updateRecurringTransaction,
} from "@/lib/actions/recurring-transaction";
import { deleteAccount } from "@/lib/actions/account";
import { deleteTransactionCategory, deleteTransactionType } from "@/lib/actions/categories";
import { currentDate } from "@/lib/recurring/materialize";
import { addMonthsToDate, nextOccurrenceOnOrAfter } from "@/lib/recurring/schedule";
import type { ActionState } from "@/lib/actions/utils";

/**
 * The recurring-transaction actions (Issue #135), and the guards that keep an
 * account, category or type from being deleted out from under a template.
 *
 * Unlike the materializer's tests, these can't inject "today": the actions
 * read CURRENT_DATE inside their transaction, as production does. Every date
 * is therefore derived from the database's today, read before each test so a
 * run that crosses midnight UTC stays consistent.
 */

const emptyState: ActionState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) if (val !== undefined) fd.append(key, val);
  return fd;
}

let today: string;
const shiftDays = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const createdAccountIds: number[] = [];
const createdCategoryIds: number[] = [];
const createdTypeIds: number[] = [];

async function createAccount(
  name: string,
  window: { openedDate?: string | null; closedDate?: string | null } = {}
): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({
      accountName: name,
      accountTypeId: 1,
      openedDate: window.openedDate ?? null,
      closedDate: window.closedDate ?? null,
    })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

/** A valid form for a daily template starting 30 days from today. */
const form = (accountId: number, overrides: Record<string, string | undefined> = {}) => ({
  transactionDescription: "Rent",
  amount: "-100.00",
  accountId: String(accountId),
  transactionTypeId: "1",
  transactionCategoryId: "1",
  cadence: "daily",
  intervalCount: "1",
  nextRunDate: shiftDays(today, 30),
  ...overrides,
});

async function insertTemplate(values: Partial<typeof recurringTransactions.$inferInsert> & { accountId: number; anchorDate: string }) {
  const [row] = await db
    .insert(recurringTransactions)
    .values({
      transactionDescription: "Seeded template",
      amount: "-10.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
      cadence: "daily",
      nextRunDate: values.anchorDate,
      ...values,
    })
    .returning({ id: recurringTransactions.recurringTransactionId });
  return row.id;
}

async function templatesOn(accountId: number) {
  return db.select().from(recurringTransactions).where(eq(recurringTransactions.accountId, accountId));
}

async function rowsOf(templateId: number) {
  return db
    .select({ id: transactions.transactionId, date: transactions.transactionDate, amount: transactions.amount })
    .from(transactions)
    .where(eq(transactions.recurringTransactionId, templateId))
    .orderBy(asc(transactions.recurringOccurrenceDate));
}

beforeEach(async () => {
  today = await currentDate();
});

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    await db.delete(recurringTransactions).where(inArray(recurringTransactions.accountId, createdAccountIds));
    await db.delete(recurringTransactions).where(inArray(recurringTransactions.relatedAccountId, createdAccountIds));
    await db.delete(transactions).where(inArray(transactions.accountId, createdAccountIds));
    await db.delete(accountBalanceHistory).where(inArray(accountBalanceHistory.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
  }
  if (createdCategoryIds.length > 0) {
    await db.delete(transactionCategories).where(inArray(transactionCategories.transactionCategoryId, createdCategoryIds));
  }
  if (createdTypeIds.length > 0) {
    await db.delete(transactionTypes).where(inArray(transactionTypes.transactionTypeId, createdTypeIds));
  }
  createdAccountIds.length = 0;
  createdCategoryIds.length = 0;
  createdTypeIds.length = 0;
});

describe("createRecurringTransaction", () => {
  it("saves a future template, anchored on its next date, and creates nothing yet", async () => {
    const accountId = await createAccount("Recurring action: future");
    const result = await createRecurringTransaction(emptyState, makeFormData(form(accountId, { cadence: "monthly" })));

    expect(result).toEqual({ success: true, errors: {}, message: "Recurring transaction saved" });
    const [row] = await templatesOn(accountId);
    expect(row).toMatchObject({
      cadence: "monthly",
      intervalCount: 1,
      anchorDate: shiftDays(today, 30),
      nextRunDate: shiftDays(today, 30),
      endDate: null,
      isActive: true,
      relatedAccountId: null,
    });
    expect(await rowsOf(row.recurringTransactionId)).toHaveLength(0);
  });

  it("creates what is already due in the same save, attributed to the user (AC5, AC19, AC27)", async () => {
    const accountId = await createAccount("Recurring action: backfill on save");
    const result = await createRecurringTransaction(
      emptyState,
      makeFormData(form(accountId, { nextRunDate: shiftDays(today, -2), amount: "-30.00" }))
    );

    expect(result).toEqual({ success: true, errors: {}, message: "Recurring transaction saved; 3 transactions added" });
    const [template] = await templatesOn(accountId);
    const rows = await rowsOf(template.recurringTransactionId);
    expect(rows.map((r) => r.date)).toEqual([shiftDays(today, -2), shiftDays(today, -1), today]);
    expect(template.nextRunDate).toBe(shiftDays(today, 1));

    // In balances at once.
    const [balance] = await db
      .select({ cumulative: accountBalanceHistory.cumulativeBalance })
      .from(accountBalanceHistory)
      .where(and(eq(accountBalanceHistory.accountId, accountId), eq(accountBalanceHistory.balanceDate, today)));
    expect(balance.cumulative).toBe("-90.00");

    // Attributed to the person saving, not the scheduler, with the link.
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "transactions"), eq(auditLog.rowPk, String(rows[0].id))));
    expect(audit).toMatchObject({ actorSource: "app", actorLabel: "integration-test-user", action: "INSERT" });
    expect(audit.afterData).toMatchObject({
      recurring_transaction_id: template.recurringTransactionId,
      recurring_occurrence_date: shiftDays(today, -2),
    });
  });

  it("says '1 transaction added' for one (AC19)", async () => {
    const accountId = await createAccount("Recurring action: singular");
    const result = await createRecurringTransaction(emptyState, makeFormData(form(accountId, { nextRunDate: today })));
    expect(result.message).toBe("Recurring transaction saved; 1 transaction added");
  });

  it.each<[string, (accountId: number) => Record<string, string | undefined>, string, string]>([
    [
      "a next date more than a year back (AC20)",
      (id) => form(id, { nextRunDate: shiftDays(addMonthsToDate(today, -12), -1) }),
      "nextRunDate",
      "Next date can't be more than a year in the past.",
    ],
    [
      "an end date before the next date (AC21)",
      (id) => form(id, { endDate: shiftDays(today, 29) }),
      "endDate",
      "Ends must be on or after Next date.",
    ],
  ])("refuses %s, and writes nothing", async (_label, build, field, message) => {
    const accountId = await createAccount("Recurring action: refusal");
    const result = await createRecurringTransaction(emptyState, makeFormData(build(accountId)));

    expect(result).toEqual({ success: false, errors: { [field]: [message] }, message: "Validation failed" });
    expect(await templatesOn(accountId)).toHaveLength(0);
  });

  it("refuses a next date before the account opened (AC20)", async () => {
    const accountId = await createAccount("Recurring action: opens later", { openedDate: shiftDays(today, 60) });
    const result = await createRecurringTransaction(emptyState, makeFormData(form(accountId)));
    expect(result.errors.nextRunDate).toEqual(["Next date is before this account was opened."]);
    expect(await templatesOn(accountId)).toHaveLength(0);
  });

  it("refuses an active template on a closed account (AC20)", async () => {
    const accountId = await createAccount("Recurring action: closed", { closedDate: shiftDays(today, -5) });
    const result = await createRecurringTransaction(emptyState, makeFormData(form(accountId)));
    expect(result.errors.accountId).toEqual([
      "This account is closed. Pick an open account, or leave the recurring transaction paused.",
    ]);
    expect(await templatesOn(accountId)).toHaveLength(0);
  });

  it("saves a paused template on a closed account", async () => {
    const accountId = await createAccount("Recurring action: closed, paused", { closedDate: shiftDays(today, -5) });
    const result = await createRecurringTransaction(emptyState, makeFormData(form(accountId, { isActive: "false" })));
    expect(result).toMatchObject({ success: true, message: "Recurring transaction saved" });
    expect((await templatesOn(accountId))[0].isActive).toBe(false);
  });

  it("refuses an account that doesn't exist", async () => {
    const result = await createRecurringTransaction(emptyState, makeFormData(form(2147483646)));
    expect(result.errors.accountId).toEqual(["Account not found"]);
  });

  it("returns field errors for an invalid form", async () => {
    const accountId = await createAccount("Recurring action: invalid");
    const result = await createRecurringTransaction(emptyState, makeFormData(form(accountId, { intervalCount: "0" })));
    expect(result).toMatchObject({ success: false, message: "Validation failed", errors: { intervalCount: ["Repeat every 1 to 99"] } });
    expect(await templatesOn(accountId)).toHaveLength(0);
  });
});

describe("updateRecurringTransaction", () => {
  it("keeps the anchor when only the template fields change, so the 31st survives a short month (AC23)", async () => {
    const accountId = await createAccount("Recurring action: keep anchor");
    const id = await insertTemplate({ accountId, cadence: "monthly", anchorDate: "2030-01-31", nextRunDate: "2030-02-28" });

    const result = await updateRecurringTransaction(
      emptyState,
      makeFormData({
        ...form(accountId, { cadence: "monthly", nextRunDate: "2030-02-28", transactionDescription: "Rent (new landlord)" }),
        recurringTransactionId: String(id),
      })
    );

    expect(result).toEqual({ success: true, errors: {}, message: "Recurring transaction updated" });
    const [row] = await templatesOn(accountId);
    expect(row).toMatchObject({ transactionDescription: "Rent (new landlord)", anchorDate: "2030-01-31", nextRunDate: "2030-02-28" });
  });

  it("starts a new schedule from the next date when the schedule changes (AC23)", async () => {
    const accountId = await createAccount("Recurring action: new anchor");
    const id = await insertTemplate({ accountId, cadence: "monthly", anchorDate: "2030-01-31", nextRunDate: "2030-02-28" });

    const result = await updateRecurringTransaction(
      emptyState,
      makeFormData({
        ...form(accountId, { cadence: "monthly", intervalCount: "3", nextRunDate: "2030-03-15" }),
        recurringTransactionId: String(id),
      })
    );

    expect(result.success).toBe(true);
    const [row] = await templatesOn(accountId);
    expect(row).toMatchObject({ intervalCount: 3, anchorDate: "2030-03-15", nextRunDate: "2030-03-15" });
  });

  it("keeps the stored active flag when the form doesn't send one", async () => {
    const accountId = await createAccount("Recurring action: keep paused");
    const id = await insertTemplate({ accountId, anchorDate: "2030-01-01", isActive: false });
    await updateRecurringTransaction(
      emptyState,
      makeFormData({ ...form(accountId, { nextRunDate: "2030-01-01" }), recurringTransactionId: String(id) })
    );
    expect((await templatesOn(accountId))[0].isActive).toBe(false);
  });

  it("skips the dates missed while paused when resumed (AC24)", async () => {
    const accountId = await createAccount("Recurring action: resume");
    const pausedSince = shiftDays(today, -10);
    const id = await insertTemplate({ accountId, anchorDate: pausedSince, isActive: false });

    const result = await updateRecurringTransaction(
      emptyState,
      makeFormData({ ...form(accountId, { nextRunDate: pausedSince, isActive: "true" }), recurringTransactionId: String(id) })
    );

    expect(result.message).toBe("Recurring transaction updated; 1 transaction added");
    expect((await rowsOf(id)).map((r) => r.date)).toEqual([today]);
    expect((await templatesOn(accountId))[0]).toMatchObject({
      isActive: true,
      anchorDate: pausedSince,
      nextRunDate: shiftDays(today, 1),
    });
  });

  it("backfills from an explicit next date set while resuming (AC24)", async () => {
    const accountId = await createAccount("Recurring action: resume with date");
    const id = await insertTemplate({ accountId, anchorDate: shiftDays(today, -10), isActive: false });

    const result = await updateRecurringTransaction(
      emptyState,
      makeFormData({ ...form(accountId, { nextRunDate: shiftDays(today, -2), isActive: "true" }), recurringTransactionId: String(id) })
    );

    expect(result.message).toBe("Recurring transaction updated; 3 transactions added");
    expect((await rowsOf(id)).map((r) => r.date)).toEqual([shiftDays(today, -2), shiftDays(today, -1), today]);
  });

  it("lets an Ended template be edited, and extended (AC22)", async () => {
    const accountId = await createAccount("Recurring action: ended");
    const anchor = shiftDays(today, -28);
    const end = shiftDays(today, -14);
    const schedule = { cadence: "weekly" as const, every: 1, anchorDate: anchor, endDate: end };
    const next = nextOccurrenceOnOrAfter(schedule, shiftDays(end, 1)); // the first occurrence past the end
    const id = await insertTemplate({ accountId, cadence: "weekly", anchorDate: anchor, nextRunDate: next, endDate: end });

    const renamed = await updateRecurringTransaction(
      emptyState,
      makeFormData({
        ...form(accountId, { cadence: "weekly", nextRunDate: next, endDate: end, transactionDescription: "Gym (old)" }),
        recurringTransactionId: String(id),
      })
    );
    expect(renamed).toEqual({ success: true, errors: {}, message: "Recurring transaction updated" });
    expect(await rowsOf(id)).toHaveLength(0);

    const extended = await updateRecurringTransaction(
      emptyState,
      makeFormData({
        ...form(accountId, { cadence: "weekly", nextRunDate: next, endDate: shiftDays(today, 60) }),
        recurringTransactionId: String(id),
      })
    );
    expect(extended.success).toBe(true);
    // Everything from the old next date through today is now due.
    expect((await rowsOf(id))[0].date).toBe(next);
  });

  it("refuses a closed account without changing the row (AC20)", async () => {
    const accountId = await createAccount("Recurring action: update refused");
    const closedId = await createAccount("Recurring action: closed target", { closedDate: shiftDays(today, -1) });
    const id = await insertTemplate({ accountId, anchorDate: "2030-01-01" });
    const [before] = await templatesOn(accountId);

    const result = await updateRecurringTransaction(
      emptyState,
      makeFormData({
        ...form(closedId, { nextRunDate: "2030-01-01", transactionDescription: "Moved" }),
        recurringTransactionId: String(id),
      })
    );

    expect(result.errors.accountId).toEqual([
      "This account is closed. Pick an open account, or leave the recurring transaction paused.",
    ]);
    expect(await templatesOn(accountId)).toEqual([before]);
  });

  it("says when the template doesn't exist", async () => {
    const accountId = await createAccount("Recurring action: missing");
    const result = await updateRecurringTransaction(
      emptyState,
      makeFormData({ ...form(accountId), recurringTransactionId: "2147483646" })
    );
    expect(result).toEqual({ success: false, errors: {}, message: "Recurring transaction not found" });
  });

  it("refuses a malformed id before reaching the database", async () => {
    const accountId = await createAccount("Recurring action: bad id");
    const result = await updateRecurringTransaction(emptyState, makeFormData({ ...form(accountId), recurringTransactionId: "1.5" }));
    expect(result).toEqual({ success: false, errors: {}, message: "Invalid recurring transaction ID" });
  });
});

describe("deleteRecurringTransaction", () => {
  it("removes the template and keeps the transactions it created (AC25)", async () => {
    const accountId = await createAccount("Recurring action: delete");
    await createRecurringTransaction(emptyState, makeFormData(form(accountId, { nextRunDate: shiftDays(today, -1) })));
    const [template] = await templatesOn(accountId);

    const result = await deleteRecurringTransaction(
      emptyState,
      makeFormData({ recurringTransactionId: String(template.recurringTransactionId) })
    );

    expect(result).toEqual({
      success: true,
      errors: {},
      message: "Recurring transaction deleted. Transactions it already added are kept.",
    });
    expect(await templatesOn(accountId)).toHaveLength(0);
    expect(await rowsOf(template.recurringTransactionId)).toHaveLength(2);
  });

  it("says when the template doesn't exist", async () => {
    const result = await deleteRecurringTransaction(emptyState, makeFormData({ recurringTransactionId: "2147483646" }));
    expect(result).toEqual({ success: false, errors: {}, message: "Recurring transaction not found" });
  });
});

describe("delete guards", () => {
  it("refuses to delete an account a template uses, and keeps it", async () => {
    const accountId = await createAccount("Recurring guard: account");
    await insertTemplate({ accountId, anchorDate: "2030-01-01" });

    const result = await deleteAccount(emptyState, makeFormData({ accountId: String(accountId) }));

    expect(result).toEqual({
      success: false,
      errors: {},
      message: "Cannot delete an account used by a recurring transaction. Delete the recurring transaction first.",
    });
    expect(await db.select().from(accounts).where(eq(accounts.accountId, accountId))).toHaveLength(1);
  });

  it("refuses to delete an account a template uses as its related account", async () => {
    const accountId = await createAccount("Recurring guard: primary");
    const relatedId = await createAccount("Recurring guard: related");
    await insertTemplate({ accountId, relatedAccountId: relatedId, anchorDate: "2030-01-01" });

    const result = await deleteAccount(emptyState, makeFormData({ accountId: String(relatedId) }));

    expect(result).toEqual({
      success: false,
      errors: {},
      message: "Cannot delete an account used by a recurring transaction. Delete the recurring transaction first.",
    });
    expect(await db.select().from(accounts).where(eq(accounts.accountId, relatedId))).toHaveLength(1);
  });

  it("refuses to delete a category a template uses", async () => {
    const accountId = await createAccount("Recurring guard: category");
    const [category] = await db
      .insert(transactionCategories)
      .values({ transactionCategory: "Recurring guard category" })
      .returning({ id: transactionCategories.transactionCategoryId });
    createdCategoryIds.push(category.id);
    await insertTemplate({ accountId, anchorDate: "2030-01-01", transactionCategoryId: category.id });

    const result = await deleteTransactionCategory(emptyState, makeFormData({ transactionCategoryId: String(category.id) }));

    expect(result).toEqual({ success: false, errors: {}, message: "Cannot delete: this category is used by a recurring transaction." });
    expect(
      await db.select().from(transactionCategories).where(eq(transactionCategories.transactionCategoryId, category.id))
    ).toHaveLength(1);
  });

  it("refuses to delete a type a template uses", async () => {
    const accountId = await createAccount("Recurring guard: type");
    const [type] = await db
      .insert(transactionTypes)
      .values({ transactionType: "Recurring guard type" })
      .returning({ id: transactionTypes.transactionTypeId });
    createdTypeIds.push(type.id);
    await insertTemplate({ accountId, anchorDate: "2030-01-01", transactionTypeId: type.id });

    const result = await deleteTransactionType(emptyState, makeFormData({ transactionTypeId: String(type.id) }));

    expect(result).toEqual({ success: false, errors: {}, message: "Cannot delete: this type is used by a recurring transaction." });
    expect(await db.select().from(transactionTypes).where(eq(transactionTypes.transactionTypeId, type.id))).toHaveLength(1);
  });
});
