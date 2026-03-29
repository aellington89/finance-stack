import { z } from "zod/v4";

export const entityNameSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer"),
});

export const accountTypeSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer"),
  accountTypeCategoryId: z
    .string()
    .min(1, "Category is required")
    .refine((val) => Number.isInteger(Number(val)) && Number(val) > 0, {
      message: "Invalid category",
    }),
});

export type EntityNameData = z.infer<typeof entityNameSchema>;
export type AccountTypeData = z.infer<typeof accountTypeSchema>;
