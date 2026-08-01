import { z } from "zod/v4";
import { isEntityId } from "@/lib/validations/id";

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
export type AccountTypeData = z.infer<typeof accountTypeSchema>;
