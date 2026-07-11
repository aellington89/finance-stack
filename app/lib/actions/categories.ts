"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  transactionCategories,
  transactionTypes,
  accountTypeCategories,
  accountTypes,
  transactions,
  accounts,
} from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { entityNameSchema, accountTypeSchema } from "@/lib/validations/categories";
import { type ActionState, buildFieldErrors } from "@/lib/actions/utils";
import { requireActionUser } from "@/lib/auth/guard";

function revalidateCategoryPaths() {
  revalidatePath("/settings/categories");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/accounts/new");
}

function parseNameForm(formData: FormData) {
  return entityNameSchema.safeParse({ name: formData.get("name") as string });
}

// ─── Transaction Categories ───────────────────────────────────────────────────

export async function createTransactionCategory(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db.insert(transactionCategories).values({ transactionCategory: result.data.name });
  } catch (error) {
    console.error("createTransactionCategory failed:", error);
    return { success: false, errors: {}, message: "Failed to create category. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Category created" };
}

export async function updateTransactionCategory(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("transactionCategoryId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db
      .update(transactionCategories)
      .set({ transactionCategory: result.data.name })
      .where(eq(transactionCategories.transactionCategoryId, id));
  } catch (error) {
    console.error("updateTransactionCategory failed:", error);
    return { success: false, errors: {}, message: "Failed to update category. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Category updated" };
}

export async function deleteTransactionCategory(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("transactionCategoryId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const inUse = await db
    .select({ id: transactions.transactionId })
    .from(transactions)
    .where(eq(transactions.transactionCategoryId, id))
    .limit(1);

  if (inUse.length > 0) {
    return {
      success: false,
      errors: {},
      message: "Cannot delete: this category is used by existing transactions.",
    };
  }

  try {
    await db.delete(transactionCategories).where(eq(transactionCategories.transactionCategoryId, id));
  } catch (error) {
    console.error("deleteTransactionCategory failed:", error);
    return { success: false, errors: {}, message: "Failed to delete category. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Category deleted" };
}

// ─── Transaction Types ────────────────────────────────────────────────────────

export async function createTransactionType(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db.insert(transactionTypes).values({ transactionType: result.data.name });
  } catch (error) {
    console.error("createTransactionType failed:", error);
    return { success: false, errors: {}, message: "Failed to create type. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Type created" };
}

export async function updateTransactionType(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("transactionTypeId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db
      .update(transactionTypes)
      .set({ transactionType: result.data.name })
      .where(eq(transactionTypes.transactionTypeId, id));
  } catch (error) {
    console.error("updateTransactionType failed:", error);
    return { success: false, errors: {}, message: "Failed to update type. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Type updated" };
}

export async function deleteTransactionType(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("transactionTypeId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const inUse = await db
    .select({ id: transactions.transactionId })
    .from(transactions)
    .where(eq(transactions.transactionTypeId, id))
    .limit(1);

  if (inUse.length > 0) {
    return {
      success: false,
      errors: {},
      message: "Cannot delete: this type is used by existing transactions.",
    };
  }

  try {
    await db.delete(transactionTypes).where(eq(transactionTypes.transactionTypeId, id));
  } catch (error) {
    console.error("deleteTransactionType failed:", error);
    return { success: false, errors: {}, message: "Failed to delete type. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Type deleted" };
}

// ─── Account Type Categories ──────────────────────────────────────────────────

export async function createAccountTypeCategory(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db.insert(accountTypeCategories).values({ accountTypeCategory: result.data.name });
  } catch (error) {
    console.error("createAccountTypeCategory failed:", error);
    return { success: false, errors: {}, message: "Failed to create category. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Category created" };
}

export async function updateAccountTypeCategory(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("accountTypeCategoryId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db
      .update(accountTypeCategories)
      .set({ accountTypeCategory: result.data.name })
      .where(eq(accountTypeCategories.accountTypeCategoryId, id));
  } catch (error) {
    console.error("updateAccountTypeCategory failed:", error);
    return { success: false, errors: {}, message: "Failed to update category. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Category updated" };
}

export async function deleteAccountTypeCategory(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("accountTypeCategoryId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const inUse = await db
    .select({ id: accountTypes.accountTypeId })
    .from(accountTypes)
    .where(eq(accountTypes.accountTypeCategoryId, id))
    .limit(1);

  if (inUse.length > 0) {
    return {
      success: false,
      errors: {},
      message: "Cannot delete: this category has account types assigned to it.",
    };
  }

  try {
    await db.delete(accountTypeCategories).where(eq(accountTypeCategories.accountTypeCategoryId, id));
  } catch (error) {
    console.error("deleteAccountTypeCategory failed:", error);
    return { success: false, errors: {}, message: "Failed to delete category. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Category deleted" };
}

// ─── Account Types ────────────────────────────────────────────────────────────

export async function createAccountType(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = accountTypeSchema.safeParse({
    name: formData.get("name") as string,
    accountTypeCategoryId: formData.get("accountTypeCategoryId") as string,
  });

  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db.insert(accountTypes).values({
      accountType: result.data.name,
      accountTypeCategoryId: Number(result.data.accountTypeCategoryId),
    });
  } catch (error) {
    console.error("createAccountType failed:", error);
    return { success: false, errors: {}, message: "Failed to create account type. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Account type created" };
}

export async function updateAccountType(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("accountTypeId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const result = accountTypeSchema.safeParse({
    name: formData.get("name") as string,
    accountTypeCategoryId: formData.get("accountTypeCategoryId") as string,
  });

  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await db
      .update(accountTypes)
      .set({
        accountType: result.data.name,
        accountTypeCategoryId: Number(result.data.accountTypeCategoryId),
      })
      .where(eq(accountTypes.accountTypeId, id));
  } catch (error) {
    console.error("updateAccountType failed:", error);
    return { success: false, errors: {}, message: "Failed to update account type. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Account type updated" };
}

export async function deleteAccountType(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = Number(formData.get("accountTypeId"));
  if (!id || id <= 0) return { success: false, errors: {}, message: "Invalid ID" };

  const inUse = await db
    .select({ id: accounts.accountId })
    .from(accounts)
    .where(eq(accounts.accountTypeId, id))
    .limit(1);

  if (inUse.length > 0) {
    return {
      success: false,
      errors: {},
      message: "Cannot delete: this account type is used by existing accounts.",
    };
  }

  try {
    await db.delete(accountTypes).where(eq(accountTypes.accountTypeId, id));
  } catch (error) {
    console.error("deleteAccountType failed:", error);
    return { success: false, errors: {}, message: "Failed to delete account type. Please try again." };
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Account type deleted" };
}
