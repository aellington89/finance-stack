/**
 * Shared shape for the three "balance over time, split by something" charts.
 *
 * Recharts wants one object per x-axis tick with a named property per series
 * — the long rows the query returns have to be pivoted into that. The pivot
 * is the only real logic in those chart files, which is why it lives here
 * rather than beside the JSX (Issue #296).
 */

export interface PivotedRow {
  date: string;
  [seriesKey: string]: number | string;
}

export interface SeriesInfo {
  key: string;
  label: string;
  color: string;
  categoryId?: number;
}

/** The fields a pivot needs; both asset and liability points satisfy it. */
export interface CategoryPoint {
  date: string;
  categoryId: number;
  categoryName: string;
  cumulativeBalance: number;
}

export const FALLBACK_SERIES_COLOR = "#6b7280";

/**
 * One series per category, one row per date, balances summed within a cell.
 *
 * Callers pass their own colour map because the asset and liability charts
 * use different palettes; an unmapped category falls back to grey rather than
 * rendering an invisible series. Before #296 this existed as two byte-identical
 * copies differing only in the point type they accepted.
 */
export function pivotByCategory(
  points: CategoryPoint[],
  categoryColors: Record<number, string>
): { rows: PivotedRow[]; series: SeriesInfo[] } {
  const seriesMap = new Map<number, SeriesInfo>();
  for (const p of points) {
    if (!seriesMap.has(p.categoryId)) {
      seriesMap.set(p.categoryId, {
        key: `cat_${p.categoryId}`,
        label: p.categoryName,
        color: categoryColors[p.categoryId] ?? FALLBACK_SERIES_COLOR,
        categoryId: p.categoryId,
      });
    }
  }

  // Sorted by id rather than by name so the stacking order is stable across
  // reloads and across date ranges that happen to omit a category.
  const series = Array.from(seriesMap.values()).sort(
    (a, b) => (a.categoryId ?? 0) - (b.categoryId ?? 0)
  );

  return { rows: buildRows(points, series, (p) => `cat_${p.categoryId}`), series };
}

/** The level a net-worth decomposition is split at. */
export type DecompositionMode = "category" | "account-type" | "account";

export interface DecompositionPointLike {
  date: string;
  categoryId: number;
  categoryName: string;
  accountTypeId: number;
  accountTypeName: string;
  accountId: number;
  accountName: string;
  cumulativeBalance: number;
}

/**
 * The same pivot, but the series key is chosen by drill-down level and the
 * colours cycle a palette rather than coming from a per-category map.
 */
export function pivotDecomposition(
  points: DecompositionPointLike[],
  mode: DecompositionMode,
  palette: string[]
): { rows: PivotedRow[]; series: SeriesInfo[] } {
  const keyFor = (p: DecompositionPointLike) => {
    if (mode === "category") return `cat_${p.categoryId}`;
    if (mode === "account-type") return `type_${p.accountTypeId}`;
    return `acct_${p.accountId}`;
  };
  const labelFor = (p: DecompositionPointLike) => {
    if (mode === "category") return p.categoryName;
    if (mode === "account-type") return p.accountTypeName;
    return p.accountName;
  };

  const seriesMap = new Map<string, string>();
  for (const p of points) {
    const key = keyFor(p);
    if (!seriesMap.has(key)) seriesMap.set(key, labelFor(p));
  }

  // Insertion order, so series colours follow the order the query returned.
  const series: SeriesInfo[] = Array.from(seriesMap.entries()).map(
    ([key, label], i) => ({ key, label, color: palette[i % palette.length] })
  );

  return { rows: buildRows(points, series, keyFor), series };
}

/**
 * One row per date, every series key present (as 0 when absent so recharts
 * draws a continuous line rather than a gap), summed within a cell.
 */
function buildRows<T extends { date: string; cumulativeBalance: number }>(
  points: T[],
  series: SeriesInfo[],
  keyFor: (p: T) => string
): PivotedRow[] {
  const dateMap = new Map<string, PivotedRow>();
  for (const p of points) {
    if (!dateMap.has(p.date)) {
      const row: PivotedRow = { date: p.date };
      for (const s of series) row[s.key] = 0;
      dateMap.set(p.date, row);
    }
    const row = dateMap.get(p.date)!;
    const key = keyFor(p);
    row[key] = ((row[key] as number) || 0) + p.cumulativeBalance;
  }

  // ISO dates, so a lexical sort is a chronological one.
  return Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}
