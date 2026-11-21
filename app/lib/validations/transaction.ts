import { z } from "zod/v4";
import { isEntityId } from "@/lib/validations/id";

/**
 * Each `z.string(...)` carries an authored message so an omitted field — which
 * `formData.get()` yields as `null` — cannot surface Zod's own "Invalid input:
 * expected string, received null" through `buildFieldErrors()` (Issue #179).
 * See docs/input-validation.md.
 *
 * The six fields other than the date are shared with the recurring-transaction
 * template (Issue #135), which carries the same fields and copies them onto
 * every row it creates. They are exported as a shape plus a refinement, rather
 * than the template `.omit()`ting a refined schema, so both schemas read the
 * same rules and messages from one place.
 */
export const transactionFieldShapes = {
  transactionDescription: z
    .string("Description is required")
    .min(1, "Description is required")
    .max(500, "Description must be 500 characters or fewer"),
  amount: z
    .string("Amount is required")
    .min(1, "Amount is required")
    .regex(
      /^-?\d{1,13}(\.\d{1,2})?$/,
      "Enter a valid dollar amount (e.g. 123.45 or -50.00)"
    ),
  accountId: z
    .string("Account is required")
    .min(1, "Account is required")
    .refine(isEntityId, { message: "Invalid account" }),
  relatedAccountId: z
    .string("Invalid related account")
    .optional()
    .refine((val) => !val || isEntityId(val), {
      message: "Invalid related account",
    }),
  transactionTypeId: z
    .string("Transaction type is required")
    .min(1, "Transaction type is required")
    .refine(isEntityId, { message: "Invalid transaction type" }),
  transactionCategoryId: z
    .string("Category is required")
    .min(1, "Category is required")
    .refine(isEntityId, { message: "Invalid category" }),
};

/** The account/related-account rule, shared by both schemas' `.refine()`. */
export function relatedAccountDiffers(data: { accountId: string; relatedAccountId?: string }): boolean {
  return !data.relatedAccountId || data.relatedAccountId !== data.accountId;
}

export function relatedAccountDiffersParams() {
  return {
    message: "Related account must be different from the primary account",
    path: ["relatedAccountId"],
  };
}

export const transactionFormSchema = z
  .object({
    transactionDescription: transactionFieldShapes.transactionDescription,
    transactionDate: z
      .string("Date is required")
      .min(1, "Date is required")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    amount: transactionFieldShapes.amount,
    accountId: transactionFieldShapes.accountId,
    relatedAccountId: transactionFieldShapes.relatedAccountId,
    transactionTypeId: transactionFieldShapes.transactionTypeId,
    transactionCategoryId: transactionFieldShapes.transactionCategoryId,
  })
  .refine(relatedAccountDiffers, relatedAccountDiffersParams());

export type TransactionFormData = z.infer<typeof transactionFormSchema>;
