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
  let dateTo = coerce(params.dateTo);

  if (dateFrom && dateTo && dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  if (applyDefault && !dateFrom) {
    dateFrom = todayMinusDays(defaultDays);
  }

  return { dateFrom, dateTo };
}
