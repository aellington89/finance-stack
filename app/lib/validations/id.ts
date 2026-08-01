import { z } from "zod/v4";

/**
 * Canonical validation for a surrogate-key ID arriving from outside the app —
 * a hidden form field, a URL search param, a dynamic route segment (Issue #179).
 *
 * This replaces sixteen hand-rolled `Number(formData.get(id))` guards. The two
 * variants that existed rejected `NaN`, `""` and `0`, but the weaker of them
 * (`!id || id <= 0`) passed `"1.5"`, `"Infinity"` and anything past `int4`.
 * Those reach Postgres as a bound parameter on an `integer` column and raise
 * `22P02 invalid input syntax for type integer` / `22003 out of range` — a
 * thrown driver error where the caller expected a validation result.
 *
 * The upper bound is not cosmetic: `.int().positive()` accepts 2147483648,
 * which is a perfectly good JavaScript integer and a range error in Postgres.
 * Every ID column in the schema is `integer`, so the ceiling belongs here.
 */
export const entityIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(2_147_483_647);

/**
 * Narrow an untrusted ID to a positive `int4`, or `null` when it is anything
 * else. Takes `unknown` so it can be handed a `FormDataEntryValue | null`
 * (which is `string | File | null`) or a route param without a cast at the
 * call site:
 *
 *   const accountId = parseEntityId(formData.get("accountId"));
 *   if (accountId === null) {
 *     return { success: false, errors: {}, message: "Invalid account ID" };
 *   }
 *
 * Callers supply their own user-facing message — the schema's messages are Zod
 * defaults and are never shown (see docs/input-validation.md).
 */
export function parseEntityId(value: unknown): number | null {
  const result = entityIdSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Predicate form, for the foreign-key fields *inside* a form schema:
 *
 *   accountTypeId: z.string("Account type is required")
 *     .min(1, "Account type is required")
 *     .refine(isEntityId, { message: "Invalid account type" }),
 *
 * These were `Number.isInteger(Number(val)) && Number(val) > 0`, which is right
 * about `1.5` and `Infinity` but has no ceiling — so `2147483648` passed
 * validation and raised `22003` on the insert. Routing every ID through one
 * schema is what stops the two checks from drifting apart again.
 */
export function isEntityId(value: unknown): boolean {
  return entityIdSchema.safeParse(value).success;
}
