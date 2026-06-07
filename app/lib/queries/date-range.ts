type SearchParams = Record<string, string | string[] | undefined>;

interface Options {
  applyDefault?: boolean;
  defaultDays?: number;
}

function coerce(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v || undefined;
}

function todayMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function getDateRangeFromParams(
  params: SearchParams,
  opts: { applyDefault: false; defaultDays?: number }
): { dateFrom: string | undefined; dateTo: string | undefined };
export function getDateRangeFromParams(
  params: SearchParams,
  opts?: { applyDefault?: true; defaultDays?: number }
): { dateFrom: string; dateTo: string | undefined };
export function getDateRangeFromParams(
  params: SearchParams,
  opts: Options = {}
): { dateFrom: string | undefined; dateTo: string | undefined } {
  const { applyDefault = true, defaultDays = 30 } = opts;

  let dateFrom = coerce(params.dateFrom);
  const dateTo = coerce(params.dateTo);

  // Ordering (dateFrom <= dateTo) and format are enforced upstream by
  // validateDateRange() at the page boundary — see lib/validations/date-range.ts.
  // This helper only coerces params and applies the default window.

  if (applyDefault && !dateFrom) {
    dateFrom = todayMinusDays(defaultDays);
  }

  return { dateFrom, dateTo };
}
