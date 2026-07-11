"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, accountBalanceHistory } from "@/drizzle/schema";
import { transactionFormSchema } from "@/lib/validations/transaction";
import { rebuildAccountBalance } from "@/lib/queries/rebuild-balance";
import { type ActionState, buildFieldErrors } from "@/lib/actions/utils";
import { requireActionUser } from "@/lib/auth/guard";

function revalidateTransactionPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/accounts");
}

export async function submitTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const raw = {
    transactionDescription: formData.get("transactionDescription") as string,
    transactionDate: formData.get("transactionDate") as string,
    amount: formData.get("amount") as string,
    accountId: formData.get("accountId") as string,
    relatedAccountId:
      (formData.get("relatedAccountId") as string) || undefined,
    transactionTypeId: formData.get("transactionTypeId") as string,
    transactionCategoryId: formData.get("transactionCategoryId") as string,
  };

  const result = transactionFormSchema.safeParse(raw);

  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  const data = result.data;
  const accountId = Number(data.accountId);
  const relatedAccountId = data.relatedAccountId
    ? Number(data.relatedAccountId)
    : null;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(transactions).values({
        transactionDescription: data.transactionDescription,
        transactionDate: data.transactionDate,
        accountId,
        amount: data.amount,
        relatedAccountId,
        transactionTypeId: Number(data.transactionTypeId),
        transactionCategoryId: Number(data.transactionCategoryId),
      });

      await rebuildAccountBalance(tx, accountId);

      if (relatedAccountId) {
        await rebuildAccountBalance(tx, relatedAccountId);
      }
    });
  } catch (error) {
    console.error("Transaction insert failed:", error);
    return {
      success: false,
      errors: {},
      message: "Failed to save transaction. Please try again.",
    };
  }

  revalidateTransactionPaths();

  return {
    success: true,
    errors: {},
    message: "Transaction created successfully",
  };
}

export async function updateTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const transactionId = Number(formData.get("transactionId"));
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return { success: false, errors: {}, message: "Invalid transaction ID" };
  }

  const raw = {
    transactionDescription: formData.get("transactionDescription") as string,
    transactionDate: formData.get("transactionDate") as string,
    amount: formData.get("amount") as string,
    accountId: formData.get("accountId") as string,
    relatedAccountId:
      (formData.get("relatedAccountId") as string) || undefined,
    transactionTypeId: formData.get("transactionTypeId") as string,
    transactionCategoryId: formData.get("transactionCategoryId") as string,
  };

  const result = transactionFormSchema.safeParse(raw);
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  const data = result.data;
  const newAccountId = Number(data.accountId);
  const newRelatedAccountId = data.relatedAccountId
    ? Number(data.relatedAccountId)
    : null;

  let notFound = false;

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          accountId: transactions.accountId,
          relatedAccountId: transactions.relatedAccountId,
        })
        .from(transactions)
        .where(eq(transactions.transactionId, transactionId))
        .limit(1);

      if (!existing) {
        notFound = true;
        return;
      }

      await tx
        .update(transactions)
        .set({
          transactionDescription: data.transactionDescription,
          transactionDate: data.transactionDate,
          accountId: newAccountId,
          amount: data.amount,
          relatedAccountId: newRelatedAccountId,
          transactionTypeId: Number(data.transactionTypeId),
          transactionCategoryId: Number(data.transactionCategoryId),
        })
        .where(eq(transactions.transactionId, transactionId));

      const affectedAccountIds = new Set<number>();
      affectedAccountIds.add(existing.accountId);
      if (existing.relatedAccountId !== null) {
        affectedAccountIds.add(existing.relatedAccountId);
      }
      affectedAccountIds.add(newAccountId);
      if (newRelatedAccountId !== null) {
        affectedAccountIds.add(newRelatedAccountId);
      }

      for (const id of affectedAccountIds) {
        await rebuildAccountBalance(tx, id);
      }
    });
  } catch (error) {
    console.error("Transaction update failed:", error);
    return {
      success: false,
      errors: {},
      message: "Failed to update transaction. Please try again.",
    };
  }

  if (notFound) {
    return { success: false, errors: {}, message: "Transaction not found" };
  }

  revalidateTransactionPaths();

  return {
    success: true,
    errors: {},
    message: "Transaction updated successfully",
  };
}

export async function deleteTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const transactionId = Number(formData.get("transactionId"));
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return { success: false, errors: {}, message: "Invalid transaction ID" };
  }

  let notFound = false;

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          accountId: transactions.accountId,
          relatedAccountId: transactions.relatedAccountId,
        })
        .from(transactions)
        .where(eq(transactions.transactionId, transactionId))
        .limit(1);

      if (!existing) {
        notFound = true;
        return;
      }

      await tx
        .delete(transactions)
        .where(eq(transactions.transactionId, transactionId));

      const affectedAccountIds = new Set<number>();
      affectedAccountIds.add(existing.accountId);
      if (existing.relatedAccountId !== null) {
        affectedAccountIds.add(existing.relatedAccountId);
      }

      for (const id of affectedAccountIds) {
        // rebuildAccountBalance starts its date series at MIN(transaction_date)
        // for the account; with no transactions left, the series is empty and
        // existing balance rows would be stale. Clear them first.
        const [{ count }] = await tx
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(transactions)
          .where(eq(transactions.accountId, id));

        if (count === 0) {
          await tx
            .delete(accountBalanceHistory)
            .where(eq(accountBalanceHistory.accountId, id));
        } else {
          await rebuildAccountBalance(tx, id);
        }
      }
    });
  } catch (error) {
    console.error("Transaction delete failed:", error);
    return {
      success: false,
      errors: {},
      message: "Failed to delete transaction. Please try again.",
    };
  }

  if (notFound) {
    return { success: false, errors: {}, message: "Transaction not found" };
  }

  revalidateTransactionPaths();

  return {
    success: true,
    errors: {},
    message: "Transaction deleted successfully",
  };
}
