import { z } from "zod/v4";

export const transactionFormSchema = z.object({
  transactionDescription: z
    .string()
    .min(1, "Description is required")
    .max(500, "Description must be 500 characters or fewer"),
  transactionDate: z
    .string()
    .min(1, "Date is required")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  amount: z
    .string()
    .min(1, "Amount is required")
    .regex(
      /^-?\d{1,13}(\.\d{1,2})?$/,
      "Enter a valid dollar amount (e.g. 123.45 or -50.00)"
    ),
  accountId: z
    .string()
    .min(1, "Account is required")
    .refine((val) => Number.isInteger(Number(val)) && Number(val) > 0, {
      message: "Invalid account",
    }),
  relatedAccountId: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val || (Number.isInteger(Number(val)) && Number(val) > 0),
      { message: "Invalid related account" }
    ),
  transactionTypeId: z
    .string()
    .min(1, "Transaction type is required")
    .refine((val) => Number.isInteger(Number(val)) && Number(val) > 0, {
      message: "Invalid transaction type",
    }),
  transactionCategoryId: z
    .string()
    .min(1, "Category is required")
    .refine((val) => Number.isInteger(Number(val)) && Number(val) > 0, {
      message: "Invalid category",
    }),
});

export type TransactionFormData = z.infer<typeof transactionFormSchema>;
