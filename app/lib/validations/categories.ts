import { z } from "zod/v4";
import { isEntityId } from "@/lib/validations/id";
import { REPORTING_ROLE_KEYS } from "@/lib/constants/reporting-roles";

/**
 * Each `z.string(...)` carries an authored message so an omitted field — which
 * `formData.get()` yields as `null` — cannot surface Zod's own "Invalid input:
 * expected string, received null" through `buildFieldErrors()` (Issue #179).
 * See docs/input-validation.md.
 */
export const entityNameSchema = z.object({
  name: z
    .string("Name is required")
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer"),
});

/**
 * Transaction categories additionally carry an optional reporting role (Issue
 * #111) — what the category means to the aggregates, e.g. paid principal on a
 * liability.
 *
 * The field is genuinely optional in both directions: `formData.get()` yields
 * `null` when the form does not render the picker at all, and the picker's
 * "None" option submits `""`. Both mean "no role", so both normalise to `null`
 * rather than tripping the enum — clearing a role has to be possible, otherwise
 * a mis-tag would be permanent.
 *
 * `z.enum` over the registry keys is what keeps this in step with the database:
 * the same set is spelled in the CHECK constraint on transaction_categories,
 * and `npm run check:seed-references` proves the two equal. Without the enum an
 * unknown role would reach the database and come back as a constraint
 * violation, i.e. driver text where an authored message belongs.
 */
export const transactionCategorySchema = z.object({
  name: z
    .string("Name is required")
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer"),
  reportingRole: z
    .union([
      z.literal(""),
      z.null(),
      z.enum(REPORTING_ROLE_KEYS as unknown as [string, ...string[]], "Unknown reporting role"),
    ])
    .transform((value) => (value === "" || value === null ? null : value)),
});

export const accountTypeSchema = z.object({
  name: z
    .string("Name is required")
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer"),
  accountTypeCategoryId: z
    .string("Category is required")
    .min(1, "Category is required")
    .refine(isEntityId, { message: "Invalid category" }),
});

export type EntityNameData = z.infer<typeof entityNameSchema>;
export type TransactionCategoryData = z.infer<typeof transactionCategorySchema>;
export type AccountTypeData = z.infer<typeof accountTypeSchema>;
