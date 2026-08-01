import { db } from "@/lib/db";
import { sql, type SQL } from "drizzle-orm";
import {
  INCOME_TYPE,
  EXPENSE_TYPE,
  INVESTMENT_TYPE,
} from "@/lib/constants/reference-ids";
import { isValidIsoDate } from "@/lib/validations/date-range";
import { sumAmountByType, valueList } from "@/lib/queries/_aggregates";

// ── Types ──

export type TimeGrouping =
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "day_of_week"
  | "day_of_month"
  | "day_of_year"
  | "week_of_year"
  | "month_of_year"
  | "quarter_of_year";

export interface AccountingTimeSeriesPoint {
  date: string;
  totalIncome: number;
  totalExpenses: number;
  totalInvestments: number;
}

export interface AccountingPeriodTotals {
  totalIncome: number;
  totalExpenses: number;
  totalInvestments: number;
}

export interface AccountingToDateComparison {
  currentIncome: number;
  previousIncome: number;
  currentExpenses: number;
  previousExpenses: number;
  currentInvestments: number;
  previousInvestments: number;
  currentMonthLabel: string;
  previousMonthLabel: string;
}

export interface CategoryBreakdown {
  category: string;
  total: number;
}

export interface AccountingFilters {
  dateFrom?: string;
  dateTo?: string;
  descriptions?: string[];
  accountIds?: number[];
  categoryIds?: number[];
  timeGrouping?: TimeGrouping;
}

// ── Helpers ──

const ACCOUNTING_TYPE_IDS = [INCOME_TYPE.id, EXPENSE_TYPE.id, INVESTMENT_TYPE.id];

// Every date below is a bound parameter, so this is not an injection guard
// (Issue #179). It is what keeps an impossible-but-well-formed date like
// 2024-02-30 from reaching the `::date` cast and erroring there; the page
// boundary rejects these first via validateDateRange (lib/validations/date-range.ts).
function safeDate(value: string | undefined): string | undefined {
  return isValidIsoDate(value) ? value : undefined;
}

/**
 * The non-date filters, shared by the queries that build their own date window
 * (`getAccountingToDateComparison`, `getAccountingMonthlyAverages`) and by
 * `buildFilterConditions()` below, which adds the date range on top.
 */
function buildValueConditions(filters: AccountingFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.descriptions && filters.descriptions.length > 0) {
    conditions.push(sql`t.transaction_description IN (${valueList(filters.descriptions)})`);
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    conditions.push(sql`t.account_id IN (${valueList(filters.accountIds)})`);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    conditions.push(sql`t.transaction_category_id IN (${valueList(filters.categoryIds)})`);
  }

  return conditions;
}

function buildFilterConditions(filters: AccountingFilters): SQL[] {
  const conditions: SQL[] = [];

  const dateFrom = safeDate(filters.dateFrom);
  const dateTo = safeDate(filters.dateTo);

  if (dateFrom) {
    conditions.push(sql`t.transaction_date >= ${dateFrom}`);
  }
  if (dateTo) {
    conditions.push(sql`t.transaction_date <= ${dateTo}`);
  }

  return [...conditions, ...buildValueConditions(filters)];
}

/** The three transaction types this page reports on, as a bound `IN (…)` list. */
function accountingTypeFilter(): SQL {
  return sql`t.transaction_type_id IN (${valueList(ACCOUNTING_TYPE_IDS)})`;
}

function whereFromConditions(conditions: SQL[]): SQL {
  if (conditions.length === 0) return sql``;
  return sql`WHERE ${sql.join(conditions, sql` AND `)}`;
}

// Map TimeGrouping to a SQL expression for the GROUP BY key.
// date_trunc-based groupings return a date; extract-based return a number.
//
// These are `SQL` fragments rather than strings so they compose into a query
// directly. As strings they had to be re-injected with `sql.raw`, which is what
// put a raw-interpolation habit next to the user-supplied `dateFrom` a few
// lines below (Issue #179). EXTRACT's field name is a keyword, not a value, so
// those arms stay literal — but they are closed constants of this map, not
// anything a caller can reach.
const GROUPING_SQL: Record<TimeGrouping, SQL> = {
  day: sql`date_trunc('day', t.transaction_date)::date`,
  week: sql`date_trunc('week', t.transaction_date)::date`,
  month: sql`date_trunc('month', t.transaction_date)::date`,
  quarter: sql`date_trunc('quarter', t.transaction_date)::date`,
  year: sql`date_trunc('year', t.transaction_date)::date`,
  day_of_week: sql`EXTRACT(dow FROM t.transaction_date)::int`,
  day_of_month: sql`EXTRACT(day FROM t.transaction_date)::int`,
  day_of_year: sql`EXTRACT(doy FROM t.transaction_date)::int`,
  week_of_year: sql`EXTRACT(week FROM t.transaction_date)::int`,
  month_of_year: sql`EXTRACT(month FROM t.transaction_date)::int`,
  quarter_of_year: sql`EXTRACT(quarter FROM t.transaction_date)::int`,
};

// ── Query A: Time Series ──

// Interval strings for generate_series stepping
const GROUPING_INTERVALS: Partial<Record<TimeGrouping, string>> = {
  day: "1 day",
  week: "1 week",
  month: "1 month",
  quarter: "3 months",
  year: "1 year",
};

// Extract-based groupings: generate_series(start, end) integer ranges
const EXTRACT_RANGES: Partial<Record<TimeGrouping, { start: number; end: number }>> = {
  day_of_week: { start: 0, end: 6 },
  day_of_month: { start: 1, end: 31 },
  day_of_year: { start: 1, end: 366 },
  week_of_year: { start: 1, end: 53 },
  month_of_year: { start: 1, end: 12 },
  quarter_of_year: { start: 1, end: 4 },
};

export async function getAccountingTimeSeries(
  filters: AccountingFilters
): Promise<AccountingTimeSeriesPoint[]> {
  const grouping = filters.timeGrouping ?? "month";
  const groupExpr = GROUPING_SQL[grouping];
  const conditions = buildFilterConditions(filters);
  conditions.push(accountingTypeFilter());
  const where = whereFromConditions(conditions);

  const interval = GROUPING_INTERVALS[grouping];
  const extractRange = EXTRACT_RANGES[grouping];

  if (interval) {
    // Date-trunc groupings: generate continuous date series
    const dateFrom = safeDate(filters.dateFrom) ?? new Date().toISOString().slice(0, 10);
    const dateTo = safeDate(filters.dateTo) ?? new Date().toISOString().slice(0, 10);
    const truncUnit = TO_DATE_TRUNCATIONS[grouping] ?? "month";

    // date_trunc's unit and the generate_series step both bind as ordinary
    // parameters (`date_trunc($1::text, $2::date)`, `$3::interval`). Before
    // Issue #179 this block interpolated `dateFrom` — a URL search param —
    // into a `sql.raw` string, held back from the SQL text only by the regex
    // in safeDate().
    //
    // The casts are load-bearing, not decoration: a bound parameter arrives as
    // `unknown`, and both date_trunc and generate_series are overloaded, so
    // without them Postgres cannot pick an implementation (42725).
    const result = await db.execute(sql`
      WITH series AS (
        SELECT date_trunc(${truncUnit}::text, d)::date AS date
        FROM generate_series(
          date_trunc(${truncUnit}::text, ${dateFrom}::date)::date,
          ${dateTo}::date,
          ${interval}::interval
        ) AS d
      ),
      agg AS (
        SELECT
          ${groupExpr} AS date,
          ${sumAmountByType(INCOME_TYPE.id, "total_income")},
          ${sumAmountByType(EXPENSE_TYPE.id, "total_expenses")},
          ${sumAmountByType(INVESTMENT_TYPE.id, "total_investments")}
        FROM transactions t
        ${where}
        GROUP BY 1
      )
      SELECT
        s.date,
        COALESCE(a.total_income, 0) AS total_income,
        COALESCE(a.total_expenses, 0) AS total_expenses,
        COALESCE(a.total_investments, 0) AS total_investments
      FROM series s
      LEFT JOIN agg a ON a.date = s.date
      ORDER BY s.date ASC
    `);

    return (result.rows as { date: string; total_income: string; total_expenses: string; total_investments: string }[]).map(
      (row) => ({
        date: row.date,
        totalIncome: parseFloat(row.total_income) || 0,
        totalExpenses: parseFloat(row.total_expenses) || 0,
        totalInvestments: parseFloat(row.total_investments) || 0,
      })
    );
  }

  if (extractRange) {
    // Extract-based groupings: generate full integer range
    const result = await db.execute(sql`
      WITH series AS (
        SELECT g AS date FROM generate_series(${extractRange.start}::int, ${extractRange.end}::int) AS g
      ),
      agg AS (
        SELECT
          ${groupExpr} AS date,
          ${sumAmountByType(INCOME_TYPE.id, "total_income")},
          ${sumAmountByType(EXPENSE_TYPE.id, "total_expenses")},
          ${sumAmountByType(INVESTMENT_TYPE.id, "total_investments")}
        FROM transactions t
        ${where}
        GROUP BY 1
      )
      SELECT
        s.date,
        COALESCE(a.total_income, 0) AS total_income,
        COALESCE(a.total_expenses, 0) AS total_expenses,
        COALESCE(a.total_investments, 0) AS total_investments
      FROM series s
      LEFT JOIN agg a ON a.date = s.date
      ORDER BY s.date ASC
    `);

    return (result.rows as { date: string; total_income: string; total_expenses: string; total_investments: string }[]).map(
      (row) => ({
        date: row.date,
        totalIncome: parseFloat(row.total_income) || 0,
        totalExpenses: parseFloat(row.total_expenses) || 0,
        totalInvestments: parseFloat(row.total_investments) || 0,
      })
    );
  }

  // Fallback (shouldn't happen)
  return [];
}

// ── Query B: Period Totals ──

export async function getAccountingPeriodTotals(
  filters: AccountingFilters
): Promise<AccountingPeriodTotals> {
  const conditions = buildFilterConditions(filters);
  conditions.push(accountingTypeFilter());
  const where = whereFromConditions(conditions);

  const result = await db.execute(sql`
    SELECT
      ${sumAmountByType(INCOME_TYPE.id, "total_income")},
      ${sumAmountByType(EXPENSE_TYPE.id, "total_expenses")},
      ${sumAmountByType(INVESTMENT_TYPE.id, "total_investments")}
    FROM transactions t
    ${where}
  `);

  const row = (result.rows as { total_income: string; total_expenses: string; total_investments: string }[])[0];
  return {
    totalIncome: parseFloat(row?.total_income) || 0,
    totalExpenses: parseFloat(row?.total_expenses) || 0,
    totalInvestments: parseFloat(row?.total_investments) || 0,
  };
}

// ── Query C: To-Date Comparison (current vs previous period) ──

// Standard groupings that support to-date comparison.
// Extract-based groupings (day_of_week, month_of_year, etc.) do not.
const TO_DATE_TRUNCATIONS: Partial<Record<TimeGrouping, string>> = {
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
};

const TO_DATE_INTERVALS: Record<string, string> = {
  day: "1 day",
  week: "1 week",
  month: "1 month",
  quarter: "3 months",
  year: "1 year",
};

// to_char() format strings. Unquoted, because they bind as parameters rather
// than being spliced into the SQL text (Issue #179).
const TO_DATE_LABEL_FORMATS: Record<string, string> = {
  day: "DD Mon YYYY",
  month: "Mon YYYY",
  quarter: '"Q"Q YYYY',
  year: "YYYY",
};

// Week needs a date range label, so we build the full SQL expression
function getLabelExpr(truncation: string, alias: SQL): SQL {
  if (truncation === "week") {
    return sql`to_char(${alias}, 'FMMM.FMDD.YYYY') || ' - ' || to_char(${alias} + interval '6 days', 'FMMM.FMDD.YYYY')`;
  }
  const fmt = TO_DATE_LABEL_FORMATS[truncation] ?? "Mon YYYY";
  return sql`to_char(${alias}, ${fmt}::text)`;
}

export function isStandardGrouping(grouping: TimeGrouping): boolean {
  return grouping in TO_DATE_TRUNCATIONS;
}

export async function getAccountingToDateComparison(
  filters: AccountingFilters
): Promise<AccountingToDateComparison> {
  const grouping = filters.timeGrouping ?? "month";
  const truncation = TO_DATE_TRUNCATIONS[grouping] ?? "month";
  const intervalStr = TO_DATE_INTERVALS[truncation] ?? "1 month";
  const curLabelExpr = getLabelExpr(truncation, sql`p.cur_start`);
  const prevLabelExpr = getLabelExpr(truncation, sql`p.prev_start`);

  // Use dateTo as reference date (or today)
  const refDate = safeDate(filters.dateTo) ?? new Date().toISOString().slice(0, 10);

  // Build optional filter conditions (excluding date range — we handle that ourselves)
  const extraConditions = buildValueConditions(filters);
  extraConditions.push(accountingTypeFilter());

  const extraWhere = extraConditions.length > 0
    ? sql`AND ${sql.join(extraConditions, sql` AND `)}`
    : sql``;

  const curWindow = sql`t.transaction_date >= p.cur_start AND t.transaction_date <= p.cur_end`;
  const prevWindow = sql`t.transaction_date >= p.prev_start AND t.transaction_date <= p.prev_end`;

  const result = await db.execute(sql`
    WITH params AS (
      SELECT
        date_trunc(${truncation}::text, ${refDate}::date)::date AS cur_start,
        ${refDate}::date AS cur_end,
        (date_trunc(${truncation}::text, ${refDate}::date) - ${intervalStr}::interval)::date AS prev_start,
        (date_trunc(${truncation}::text, ${refDate}::date) - interval '1 day')::date AS prev_end
    )
    SELECT
      ${sumAmountByType(INCOME_TYPE.id, "cur_income", curWindow)},
      ${sumAmountByType(INCOME_TYPE.id, "prev_income", prevWindow)},
      ${sumAmountByType(EXPENSE_TYPE.id, "cur_expenses", curWindow)},
      ${sumAmountByType(EXPENSE_TYPE.id, "prev_expenses", prevWindow)},
      ${sumAmountByType(INVESTMENT_TYPE.id, "cur_investments", curWindow)},
      ${sumAmountByType(INVESTMENT_TYPE.id, "prev_investments", prevWindow)},
      MIN(${curLabelExpr}) AS cur_label,
      MIN(${prevLabelExpr}) AS prev_label
    FROM transactions t
    CROSS JOIN params p
    WHERE t.transaction_date >= p.prev_start
      AND t.transaction_date <= p.cur_end
      ${extraWhere}
  `);

  const row = (result.rows as Record<string, string>[])[0] ?? {};
  return {
    currentIncome: parseFloat(row.cur_income) || 0,
    previousIncome: parseFloat(row.prev_income) || 0,
    currentExpenses: parseFloat(row.cur_expenses) || 0,
    previousExpenses: parseFloat(row.prev_expenses) || 0,
    currentInvestments: parseFloat(row.cur_investments) || 0,
    previousInvestments: parseFloat(row.prev_investments) || 0,
    currentMonthLabel: row.cur_label ?? "",
    previousMonthLabel: row.prev_label ?? "",
  };
}

// ── Query D: Expense Category Breakdown ──

export async function getExpenseCategoryBreakdown(
  filters: AccountingFilters
): Promise<CategoryBreakdown[]> {
  const conditions = buildFilterConditions(filters);
  conditions.push(sql`t.transaction_type_id = ${EXPENSE_TYPE.id}`);
  const where = whereFromConditions(conditions);

  const result = await db.execute(sql`
    SELECT
      tc.transaction_category AS category,
      SUM(ABS(t.amount)) AS total
    FROM transactions t
    JOIN transaction_categories tc USING (transaction_category_id)
    ${where}
    GROUP BY tc.transaction_category
    ORDER BY total DESC
  `);

  return (result.rows as { category: string; total: string }[]).map((row) => ({
    category: row.category,
    total: parseFloat(row.total) || 0,
  }));
}

// ── Query E: Average per Month (Last 12 complete months) ──

export async function getAccountingMonthlyAverages(
  filters: AccountingFilters
): Promise<AccountingPeriodTotals> {
  // Extra filters (non-date)
  const extraConditions = buildValueConditions(filters);
  extraConditions.push(accountingTypeFilter());

  const extraWhere = extraConditions.length > 0
    ? sql`AND ${sql.join(extraConditions, sql` AND `)}`
    : sql``;

  const result = await db.execute(sql`
    WITH monthly AS (
      SELECT
        date_trunc('month', t.transaction_date) AS month,
        ${sumAmountByType(INCOME_TYPE.id, "income")},
        ${sumAmountByType(EXPENSE_TYPE.id, "expenses")},
        ${sumAmountByType(INVESTMENT_TYPE.id, "investments")}
      FROM transactions t
      WHERE t.transaction_date >= date_trunc('month', CURRENT_DATE) - interval '12 months'
        AND t.transaction_date < date_trunc('month', CURRENT_DATE)
        ${extraWhere}
      GROUP BY 1
    )
    SELECT
      COALESCE(AVG(income), 0) AS avg_income,
      COALESCE(AVG(expenses), 0) AS avg_expenses,
      COALESCE(AVG(investments), 0) AS avg_investments
    FROM monthly
  `);

  const row = (result.rows as { avg_income: string; avg_expenses: string; avg_investments: string }[])[0] ?? {};
  return {
    totalIncome: parseFloat(row.avg_income) || 0,
    totalExpenses: parseFloat(row.avg_expenses) || 0,
    totalInvestments: parseFloat(row.avg_investments) || 0,
  };
}
