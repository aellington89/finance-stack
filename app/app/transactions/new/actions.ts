"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { transactions } from "@/drizzle/schema";
import { transactionFormSchema } from "@/lib/validations/transaction";
import { rebuildAccountBalance } from "@/lib/queries/rebuild-balance";

export async function submitTransaction(
  prevState: { success: boolean; errors: Record<string, string[]>; message: string },
  formData: FormData
): Promise<{ success: boolean; errors: Record<string, string[]>; message: string }> {
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
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0]);
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    return { success: false, errors: fieldErrors, message: "Validation failed" };
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

  revalidatePath("/dashboard");
  revalidatePath("/accounts");

  return {
    success: true,
    errors: {},
    message: "Transaction created successfully",
  };
}
