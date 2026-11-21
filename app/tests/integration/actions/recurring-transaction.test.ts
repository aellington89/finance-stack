import { describe, it, expect, afterEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountBalanceHistory,
  accounts,
  recurringTransactions,
  transactionCategories,
  transactionTypes,
  transactions,
} from "@/drizzle/schema";
import { deleteAccount } from "@/lib/actions/account";
import { deleteTransactionCategory, deleteTransactionType } from "@/lib/actions/categories";
import type { ActionState } from "@/lib/actions/utils";

/**
 * The server actions' rules for recurring transactions (Issue #135): the
 * guards that keep an account, category or type from being deleted out from
 * under a template.
 */

const emptyState: ActionState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) if (val !== undefined) fd.append(key, val);
  return fd;
}

const createdAccountIds: number[] = [];
const createdCategoryIds: number[] = [];
const createdTypeIds: number[] = [];

async function createAccount(name: string): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId: 1 })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

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

    expect(result.message).toMatch(/used by a recurring transaction/);
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
