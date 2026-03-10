"use server";

import { transactionFormSchema } from "@/lib/validations/transaction";

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

  // TODO: Issue #27 — Replace with actual DB insert via Drizzle
  // TODO: Issue #28 — Trigger per-account balance history rebuild
  // TODO: revalidatePath("/dashboard")
  // TODO: revalidatePath("/accounts")

  return {
    success: true,
    errors: {},
    message: "Transaction created successfully",
  };
}
