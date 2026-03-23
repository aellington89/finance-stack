"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { accounts, accountBalanceHistory, transactions } from "@/drizzle/schema";
import { accountFormSchema } from "@/lib/validations/account";
import { rebuildAccountBalance } from "@/lib/queries/rebuild-balance";
import { eq, or } from "drizzle-orm";

const OPENING_BALANCE_TYPE_ID = 12;
const OPENING_BALANCE_CATEGORY_ID = 6; // "Other"

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

function revalidateAccountPaths() {
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/accounts");
}

export async function createAccount(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = {
    accountName: formData.get("accountName") as string,
    accountTypeId: formData.get("accountTypeId") as string,
    accountIdentifier:
      (formData.get("accountIdentifier") as string) || undefined,
    openedDate: (formData.get("openedDate") as string) || undefined,
    initialBalance:
      (formData.get("initialBalance") as string) || undefined,
  };

  const result = accountFormSchema.safeParse(raw);

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0]);
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    return { success: false, errors: fieldErrors, message: "Validation failed" };
  }

  const data = result.data;

  try {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(accounts)
        .values({
          accountName: data.accountName,
          accountTypeId: Number(data.accountTypeId),
          accountIdentifier: data.accountIdentifier || null,
          openedDate: data.openedDate || null,
        })
        .returning({ accountId: accounts.accountId });

      if (
        data.initialBalance &&
        parseFloat(data.initialBalance) !== 0
      ) {
        await tx.insert(transactions).values({
          transactionDescription: "Opening Balance",
          transactionDate: data.openedDate || new Date().toISOString().slice(0, 10),
          accountId: inserted.accountId,
          amount: data.initialBalance,
          relatedAccountId: null,
          transactionTypeId: OPENING_BALANCE_TYPE_ID,
          transactionCategoryId: OPENING_BALANCE_CATEGORY_ID,
        });

        await rebuildAccountBalance(tx, inserted.accountId);
      }
    });
  } catch (error) {
    console.error("Account creation failed:", error);
    return {
      success: false,
      errors: {},
      message: "Failed to create account. Please try again.",
    };
  }

  revalidateAccountPaths();

  return {
    success: true,
    errors: {},
    message: "Account created successfully",
  };
}

export async function updateAccount(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const accountId = Number(formData.get("accountId"));
  if (!accountId || accountId <= 0) {
    return { success: false, errors: {}, message: "Invalid account ID" };
  }

  const raw = {
    accountName: formData.get("accountName") as string,
    accountTypeId: formData.get("accountTypeId") as string,
    accountIdentifier:
      (formData.get("accountIdentifier") as string) || undefined,
    openedDate: (formData.get("openedDate") as string) || undefined,
    closedDate: (formData.get("closedDate") as string) || undefined,
  };

  const result = accountFormSchema.safeParse(raw);

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0]);
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    return { success: false, errors: fieldErrors, message: "Validation failed" };
  }

  const data = result.data;

  try {
    await db
      .update(accounts)
      .set({
        accountName: data.accountName,
        accountTypeId: Number(data.accountTypeId),
        accountIdentifier: data.accountIdentifier || null,
        openedDate: data.openedDate || null,
        closedDate: data.closedDate || null,
      })
      .where(eq(accounts.accountId, accountId));
  } catch (error) {
    console.error("Account update failed:", error);
    return {
      success: false,
      errors: {},
      message: "Failed to update account. Please try again.",
    };
  }

  revalidateAccountPaths();

  return {
    success: true,
    errors: {},
    message: "Account updated successfully",
  };
}

export async function deleteAccount(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const accountId = Number(formData.get("accountId"));
  if (!accountId || accountId <= 0) {
    return { success: false, errors: {}, message: "Invalid account ID" };
  }

  // Check for transactions referencing this account
  const txnRows = await db
    .select({ id: transactions.transactionId })
    .from(transactions)
    .where(
      or(
        eq(transactions.accountId, accountId),
        eq(transactions.relatedAccountId, accountId)
      )
    )
    .limit(1);

  if (txnRows.length > 0) {
    return {
      success: false,
      errors: {},
      message:
        "Cannot delete an account that has transactions. Close the account instead by setting a closed date.",
    };
  }

  try {
    await db.transaction(async (tx) => {
      // Clean up any balance history rows
      await tx
        .delete(accountBalanceHistory)
        .where(eq(accountBalanceHistory.accountId, accountId));

      await tx
        .delete(accounts)
        .where(eq(accounts.accountId, accountId));
    });
  } catch (error) {
    console.error("Account deletion failed:", error);
    return {
      success: false,
      errors: {},
      message: "Failed to delete account. Please try again.",
    };
  }

  revalidateAccountPaths();
  redirect("/accounts");
}
