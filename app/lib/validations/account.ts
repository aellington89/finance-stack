import { z } from "zod/v4";

export const accountFormSchema = z.object({
  accountName: z
    .string()
    .min(1, "Account name is required")
    .max(255, "Account name must be 255 characters or fewer"),
  accountTypeId: z
    .string()
    .min(1, "Account type is required")
    .refine((val) => Number.isInteger(Number(val)) && Number(val) > 0, {
      message: "Invalid account type",
    }),
  accountIdentifier: z
    .string()
    .max(50, "Identifier must be 50 characters or fewer")
    .optional(),
  openedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
  closedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
  initialBalance: z
    .string()
    .regex(
      /^-?\d{1,13}(\.\d{1,2})?$/,
      "Enter a valid dollar amount (e.g. 123.45 or -50.00)"
    )
    .optional(),
});

export type AccountFormData = z.infer<typeof accountFormSchema>;
