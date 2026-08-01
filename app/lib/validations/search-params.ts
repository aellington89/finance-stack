import { parseEntityId } from "@/lib/validations/id";

/**
 * Validation for the dashboard filter search params, and the single home for
 * the `get` / `getNumberArray` / `getStringArray` helpers that used to be
 * duplicated verbatim in the Transactions and Accounting pages (Issue #179).
 *
 * Companion to {@link validateDateRange} in ./date-range.ts, which owns
 * `dateFrom` / `dateTo` and which this deliberately mirrors: same discriminated
 * union, same "reject at the page boundary rather than let it reach SQL"
 * posture. A page calls both.
 *
 * The ID lists are the reason this exists. They were parsed with
 * `raw.split(",").map(Number).filter((n) => !isNaN(n))`, which accepts `1.5`
 * and `Infinity` — both of which are bound straight into an `IN (…)` on an
 * `integer` column and raise `22P02` in the driver, turning a crafted URL into
 * a thrown render rather than a filter that says no.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** Matches the dollar-amount shape the form schemas already enforce. */
const AMOUNT_RE = /^-?\d{1,13}(\.\d{1,2})?$/;

/** Human names for the ID-list params, used to build the error message. */
const ID_LIST_LABELS: Record<string, string> = {
  accountIds: "account",
  typeIds: "transaction type",
  categoryIds: "category",
};

export interface FilterParams {
  descriptions?: string[];
  amount?: string;
  accountIds?: number[];
  typeIds?: number[];
  categoryIds?: number[];
}

export type FilterValidation =
  | ({ ok: true } & FilterParams)
  | { ok: false; error: string };

/**
 * First value of a repeated param, or `undefined` when absent or empty.
 * Exported because pages still read single-value params (`timeGrouping`,
 * `sortBy`) that they validate against their own allowlists.
 */
export function getParam(
  params: SearchParams,
  key: string
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function getStringList(
  params: SearchParams,
  key: string
): string[] | undefined {
  const raw = getParam(params, key);
  if (!raw) return undefined;
  const items = raw.split(",").filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Parse a comma-separated ID list, or `null` when any entry is not a positive
 * `int4`. Note the *any*: an invalid entry rejects the whole list rather than
 * being dropped from it. Silently querying the remainder answers a question the
 * user did not ask, and the old filtering behaviour is what let `1.5` through
 * in the first place — `Number("1.5")` is not `NaN`.
 */
function parseIdList(
  params: SearchParams,
  key: string
): number[] | null | undefined {
  const items = getStringList(params, key);
  if (!items) return undefined;

  const ids: number[] = [];
  for (const item of items) {
    const id = parseEntityId(item);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

/**
 * Validate the filter params a dashboard page passes to the query layer.
 * Returns a discriminated union so the boundary can render a clear message
 * instead of letting a malformed value reach the database:
 *
 *   const filters = validateFilterParams(resolvedParams);
 *   if (!filters.ok) return <FilterError message={filters.error} />;
 *
 * Params a given page does not use are still validated — parsing a `typeIds`
 * the Accounting page ignores costs nothing and keeps the rule uniform.
 */
export function validateFilterParams(params: SearchParams): FilterValidation {
  const result: FilterParams = {
    descriptions: getStringList(params, "descriptions"),
  };

  for (const key of ["accountIds", "typeIds", "categoryIds"] as const) {
    const ids = parseIdList(params, key);
    if (ids === null) {
      return {
        ok: false,
        error: `The ${ID_LIST_LABELS[key]} filter contains a value that is not a valid ID.`,
      };
    }
    result[key] = ids;
  }

  const amount = getParam(params, "amount");
  if (amount !== undefined && !AMOUNT_RE.test(amount)) {
    return {
      ok: false,
      error: "Amount must be a dollar value, e.g. 123.45 or -50.00",
    };
  }
  result.amount = amount;

  return { ok: true, ...result };
}
