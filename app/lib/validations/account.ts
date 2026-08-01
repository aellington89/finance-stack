import { z } from "zod/v4";
import { isEntityId } from "@/lib/validations/id";

export const LIQUIDITY_CLASSES = [
  "liquid",
  "semi_liquid",
  "illiquid",
  "restricted",
] as const;

export type LiquidityClass = (typeof LIQUIDITY_CLASSES)[number];

/**
 * Every field carries an authored message on the *type* check as well as on its
 * constraints (Issue #179). A form field the client omits entirely arrives as
 * `null` from `formData.get()`, and a bare `z.string()` renders that as Zod's
 * own "Invalid input: expected string, received null" — internals, shown
 * verbatim to the user by `buildFieldErrors()`. See docs/input-validation.md.
 */
export const accountFormSchema = z.object({
  accountName: z
    .string("Account name is required")
    .min(1, "Account name is required")
    .max(255, "Account name must be 255 characters or fewer"),
  accountTypeId: z
    .string("Account type is required")
    .min(1, "Account type is required")
    .refine(isEntityId, { message: "Invalid account type" }),
  accountIdentifier: z
    .string("Identifier must be text")
    .max(50, "Identifier must be 50 characters or fewer")
    .optional(),
  openedDate: z
    .string("Date must be in YYYY-MM-DD format")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
  closedDate: z
    .string("Date must be in YYYY-MM-DD format")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
  initialBalance: z
    .string("Enter a valid dollar amount (e.g. 123.45 or -50.00)")
    .regex(
      /^-?\d{1,13}(\.\d{1,2})?$/,
      "Enter a valid dollar amount (e.g. 123.45 or -50.00)"
    )
    .optional(),
  liquidityClass: z
    .enum(LIQUIDITY_CLASSES, "Invalid liquidity class")
    .nullable()
    .optional(),
});

export type AccountFormData = z.infer<typeof accountFormSchema>;
