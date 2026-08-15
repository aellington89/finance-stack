"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditedTransaction } from "@/lib/db/audited";
import {
  transactionCategories,
  transactionTypes,
  accountTypeCategories,
  accountTypes,
  transactions,
  accounts,
} from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  entityNameSchema,
  accountTypeSchema,
  transactionCategorySchema,
} from "@/lib/validations/categories";
import { parseEntityId } from "@/lib/validations/id";
import { type ActionState, buildFieldErrors } from "@/lib/actions/utils";
import { actionFailure } from "@/lib/actions/failure";
import { requireActionUser } from "@/lib/auth/guard";
import { protectionFor, protectionRefusal } from "@/lib/constants/protected-rows";

// Every write below goes through auditedTransaction() even where it is a single
// statement: that helper is what names the actor for the audit trigger, and a
// bare db.insert/update/delete runs in an implicit transaction with nowhere to
// set it (Issue #180). The `inUse` pre-checks stay outside the *transaction* —
// they are reads, and holding it open across them buys nothing — but they sit
// inside the `try` (Issue #179), so a read that fails returns an ActionState
// rather than escaping the action as an unhandled throw.
//
// The protection pre-checks (Issue #109) sit after parseEntityId/safeParse so a
// malformed payload is still refused before the database is reached —
// tests/integration/actions/validation-contract.test.ts asserts exactly that. In
// the delete actions they run before the `inUse` read: a protected row is nearly
// always in use, and "it is protected" is the more actionable of the two
// messages. See lib/constants/protected-rows.ts for why rename-to-canonical is
// the one edit that gets through.
//
// protectionFor() is a pure predicate over SHIPPED_ROWS and reaches no database.
// It needed one until issue #111: the liability-pin rule matched on the row's
// current name, so the guard had to fetch the database's copy of it — the name
// in the submitted form is what the user wants it to become, not what it is.
// With that rule gone the three reads in lib/queries/protected-rows.ts had no
// remaining caller and the module was deleted.
function revalidateCategoryPaths() {
  revalidatePath("/settings/categories");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/accounts/new");
}

function parseNameForm(formData: FormData) {
  return entityNameSchema.safeParse({ name: formData.get("name") as string });
}

// Transaction categories carry a reporting role as well as a name (Issue #111).
// `formData.get()` yields null when the field is absent, which the schema treats
// as "no role" — same as the picker's "None".
function parseCategoryForm(formData: FormData) {
  return transactionCategorySchema.safeParse({
    name: formData.get("name") as string,
    reportingRole: formData.get("reportingRole") as string | null,
  });
}

// ─── Transaction Categories ───────────────────────────────────────────────────

export async function createTransactionCategory(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = parseCategoryForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await auditedTransaction(async (tx) => {
      await tx.insert(transactionCategories).values({
        transactionCategory: result.data.name,
        reportingRole: result.data.reportingRole,
      });
    });
  } catch (error) {
    return actionFailure("createTransactionCategory", error, "Failed to create category. Please try again.");
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

  const id = parseEntityId(formData.get("transactionCategoryId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid category ID" };

  const result = parseCategoryForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    const protection = protectionFor("transaction_categories", id);
    if (protection && protection.canonicalName !== result.data.name) {
      return {
        success: false,
        errors: {},
        message: protectionRefusal(protection, "rename", "category"),
      };
    }

    await auditedTransaction(async (tx) => {
      await tx
        .update(transactionCategories)
        .set({
          transactionCategory: result.data.name,
          reportingRole: result.data.reportingRole,
        })
        .where(eq(transactionCategories.transactionCategoryId, id));
    });
  } catch (error) {
    return actionFailure("updateTransactionCategory", error, "Failed to update category. Please try again.");
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

  const id = parseEntityId(formData.get("transactionCategoryId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid category ID" };

  try {
    const protection = protectionFor("transaction_categories", id);
    if (protection) {
      return {
        success: false,
        errors: {},
        message: protectionRefusal(protection, "delete", "category"),
      };
    }

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

    await auditedTransaction(async (tx) => {
      await tx.delete(transactionCategories).where(eq(transactionCategories.transactionCategoryId, id));
    });
  } catch (error) {
    return actionFailure("deleteTransactionCategory", error, "Failed to delete category. Please try again.");
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Category deleted" };
}

// ─── Transaction Types ────────────────────────────────────────────────────────
//
// There is deliberately no createTransactionType (Issue #109). All 12 rows this
// table ships are protected, and a thirteenth is a row no query, importer parser
// or SEED_REFERENCES entry would ever recognise — the same code-depends-on-a-row-
// the-user-owns defect the seed-data taxonomy names in docs/database.md. The
// affordance is gone from /settings/categories rather than the action being kept
// and made to always refuse. A legitimate future insert belongs behind the admin
// screen in #87, with a role check of its own.

export async function updateTransactionType(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = parseEntityId(formData.get("transactionTypeId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid type ID" };

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    const protection = protectionFor("transaction_types", id);
    if (protection && protection.canonicalName !== result.data.name) {
      return {
        success: false,
        errors: {},
        message: protectionRefusal(protection, "rename", "type"),
      };
    }

    await auditedTransaction(async (tx) => {
      await tx
        .update(transactionTypes)
        .set({ transactionType: result.data.name })
        .where(eq(transactionTypes.transactionTypeId, id));
    });
  } catch (error) {
    return actionFailure("updateTransactionType", error, "Failed to update type. Please try again.");
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

  const id = parseEntityId(formData.get("transactionTypeId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid type ID" };

  try {
    const protection = protectionFor("transaction_types", id);
    if (protection) {
      return {
        success: false,
        errors: {},
        message: protectionRefusal(protection, "delete", "type"),
      };
    }

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

    await auditedTransaction(async (tx) => {
      await tx.delete(transactionTypes).where(eq(transactionTypes.transactionTypeId, id));
    });
  } catch (error) {
    return actionFailure("deleteTransactionType", error, "Failed to delete type. Please try again.");
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
    await auditedTransaction(async (tx) => {
      await tx.insert(accountTypeCategories).values({ accountTypeCategory: result.data.name });
    });
  } catch (error) {
    return actionFailure("createAccountTypeCategory", error, "Failed to create category. Please try again.");
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

  const id = parseEntityId(formData.get("accountTypeCategoryId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid account type category ID" };

  const result = parseNameForm(formData);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    const protection = protectionFor("account_type_categories", id);
    if (protection && protection.canonicalName !== result.data.name) {
      return {
        success: false,
        errors: {},
        message: protectionRefusal(protection, "rename", "category"),
      };
    }

    await auditedTransaction(async (tx) => {
      await tx
        .update(accountTypeCategories)
        .set({ accountTypeCategory: result.data.name })
        .where(eq(accountTypeCategories.accountTypeCategoryId, id));
    });
  } catch (error) {
    return actionFailure("updateAccountTypeCategory", error, "Failed to update category. Please try again.");
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

  const id = parseEntityId(formData.get("accountTypeCategoryId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid account type category ID" };

  try {
    const protection = protectionFor("account_type_categories", id);
    if (protection) {
      return {
        success: false,
        errors: {},
        message: protectionRefusal(protection, "delete", "category"),
      };
    }

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

    await auditedTransaction(async (tx) => {
      await tx.delete(accountTypeCategories).where(eq(accountTypeCategories.accountTypeCategoryId, id));
    });
  } catch (error) {
    return actionFailure("deleteAccountTypeCategory", error, "Failed to delete category. Please try again.");
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
    await auditedTransaction(async (tx) => {
      await tx.insert(accountTypes).values({
        accountType: result.data.name,
        accountTypeCategoryId: Number(result.data.accountTypeCategoryId),
      });
    });
  } catch (error) {
    return actionFailure("createAccountType", error, "Failed to create account type. Please try again.");
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

  const id = parseEntityId(formData.get("accountTypeId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid account type ID" };

  const result = accountTypeSchema.safeParse({
    name: formData.get("name") as string,
    accountTypeCategoryId: formData.get("accountTypeCategoryId") as string,
  });

  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  try {
    await auditedTransaction(async (tx) => {
      await tx
        .update(accountTypes)
        .set({
          accountType: result.data.name,
          accountTypeCategoryId: Number(result.data.accountTypeCategoryId),
        })
        .where(eq(accountTypes.accountTypeId, id));
    });
  } catch (error) {
    return actionFailure("updateAccountType", error, "Failed to update account type. Please try again.");
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

  const id = parseEntityId(formData.get("accountTypeId"));
  if (id === null) return { success: false, errors: {}, message: "Invalid account type ID" };

  try {
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

    await auditedTransaction(async (tx) => {
      await tx.delete(accountTypes).where(eq(accountTypes.accountTypeId, id));
    });
  } catch (error) {
    return actionFailure("deleteAccountType", error, "Failed to delete account type. Please try again.");
  }

  revalidateCategoryPaths();
  return { success: true, errors: {}, message: "Account type deleted" };
}
