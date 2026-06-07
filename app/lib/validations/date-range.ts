import { z } from "zod/v4";

/**
 * Canonical date-range validation. This is the single source of truth for
 * `dateFrom`/`dateTo` URL params across the dashboard — do not re-implement
 * `DATE_RE`/`safeDate` in query modules; use {@link isValidIsoDate} instead.
 *
 * Ordering (`dateFrom <= dateTo`) is *enforced* here, not silently swapped:
 * an out-of-order range is rejected so the boundary can surface a clear error.
 */

type SearchParams = Record<string, string | string[] | undefined>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in zero-padded `YYYY-MM-DD` form.
 * Rejects bad formats (`2024-1-1`) and impossible dates (`2024-02-30`,
 * `2024-13-01`) — the latter would otherwise reach the SQL `::date` cast.
 */
export function isValidIsoDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const isoDate = z
  .string()
  .refine(isValidIsoDate, "Date must be a valid date in YYYY-MM-DD format");

export const dateRangeSchema = z
  .object({
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  // Lexical compare is correct for zero-padded ISO dates and matches how the
  // SQL layer compares these strings.
  .refine((d) => !d.dateFrom || !d.dateTo || d.dateFrom <= d.dateTo, {
    message: "Start date must be on or before the end date",
    path: ["dateTo"],
  });

export type DateRangeValidation =
  | { ok: true; dateFrom?: string; dateTo?: string }
  | { ok: false; error: string };

function coerce(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v || undefined;
}

/**
 * Validate raw `dateFrom`/`dateTo` search params at a page boundary. Returns a
 * discriminated union so callers can render a clear error instead of letting a
 * malformed or out-of-order range reach the query layer.
 */
export function validateDateRange(params: SearchParams): DateRangeValidation {
  const result = dateRangeSchema.safeParse({
    dateFrom: coerce(params.dateFrom),
    dateTo: coerce(params.dateTo),
  });

  if (!result.success) {
    return { ok: false, error: result.error.issues[0].message };
  }

  return { ok: true, ...result.data };
}
