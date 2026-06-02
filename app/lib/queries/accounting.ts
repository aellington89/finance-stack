import { db } from "@/lib/db";
import { sql, type SQL } from "drizzle-orm";
import {
  INCOME_TYPE,
  EXPENSE_TYPE,
  INVESTMENT_TYPE,
} from "@/lib/constants/reference-ids";

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function safeDate(value: string | undefined): string | undefined {
  return value && DATE_RE.test(value) ? value : undefined;
}

function buildFilterConditions(filters: AccountingFilters, tableAlias = "t"): SQL[] {
  const conditions: SQL[] = [];

  const dateFrom = safeDate(filters.dateFrom);
  const dateTo = safeDate(filters.dateTo);

  if (dateFrom) {
    conditions.push(sql`${sql.raw(tableAlias)}.transaction_date >= ${dateFrom}`);
  }
  if (dateTo) {
    conditions.push(sql`${sql.raw(tableAlias)}.transaction_date <= ${dateTo}`);
  }
  if (filters.descriptions && filters.descriptions.length > 0) {
    const placeholders = filters.descriptions.map((d) => sql`${d}`);
    conditions.push(sql`${sql.raw(tableAlias)}.transaction_description IN (${sql.join(placeholders, sql`, `)})`);
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    const placeholders = filters.accountIds.map((id) => sql`${id}`);
    conditions.push(sql`${sql.raw(tableAlias)}.account_id IN (${sql.join(placeholders, sql`, `)})`);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const placeholders = filters.categoryIds.map((id) => sql`${id}`);
    conditions.push(sql`${sql.raw(tableAlias)}.transaction_category_id IN (${sql.join(placeholders, sql`, `)})`);
  }

  return conditions;
}

function whereFromConditions(conditions: SQL[]): SQL {
  if (conditions.length === 0) return sql``;
  return sql`WHERE ${sql.join(conditions, sql` AND `)}`;
}

// Map TimeGrouping to a SQL expression for the GROUP BY key.
// date_trunc-based groupings return a date; extract-based return a number.
const GROUPING_SQL: Record<TimeGrouping, string> = {
  day: "date_trunc('day', t.transaction_date)::date",
  week: "date_trunc('week', t.transaction_date)::date",
  month: "date_trunc('month', t.transaction_date)::date",
  quarter: "date_trunc('quarter', t.transaction_date)::date",
  year: "date_trunc('year', t.transaction_date)::date",
  day_of_week: "EXTRACT(dow FROM t.transaction_date)::int",
  day_of_month: "EXTRACT(day FROM t.transaction_date)::int",
  day_of_year: "EXTRACT(doy FROM t.transaction_date)::int",
  week_of_year: "EXTRACT(week FROM t.transaction_date)::int",
  month_of_year: "EXTRACT(month FROM t.transaction_date)::int",
  quarter_of_year: "EXTRACT(quarter FROM t.transaction_date)::int",
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
  conditions.push(sql.raw(`t.transaction_type_id IN (${ACCOUNTING_TYPE_IDS.join(", ")})`));
  const where = whereFromConditions(conditions);

  const interval = GROUPING_INTERVALS[grouping];
  const extractRange = EXTRACT_RANGES[grouping];

  if (interval) {
    // Date-trunc groupings: generate continuous date series
    const dateFrom = safeDate(filters.dateFrom) ?? new Date().toISOString().slice(0, 10);
    const dateTo = safeDate(filters.dateTo) ?? new Date().toISOString().slice(0, 10);
    const truncUnit = TO_DATE_TRUNCATIONS[grouping] ?? "month";

    const result = await db.execute(sql`
      WITH series AS (
        SELECT ${sql.raw(`date_trunc('${truncUnit}', d)::date`)} AS date
        FROM generate_series(
          ${sql.raw(`date_trunc('${truncUnit}', '${dateFrom}'::date)`)}::date,
          ${dateTo}::date,
          ${sql.raw(`'${interval}'::interval`)}
        ) AS d
      ),
      agg AS (
        SELECT
          ${sql.raw(groupExpr)} AS date,
          SUM(CASE WHEN t.transaction_type_id = ${INCOME_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_income,
          SUM(CASE WHEN t.transaction_type_id = ${EXPENSE_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_expenses,
          SUM(CASE WHEN t.transaction_type_id = ${INVESTMENT_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_investments
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
        SELECT g AS date FROM generate_series(${sql.raw(String(extractRange.start))}, ${sql.raw(String(extractRange.end))}) AS g
      ),
      agg AS (
        SELECT
          ${sql.raw(groupExpr)} AS date,
          SUM(CASE WHEN t.transaction_type_id = ${INCOME_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_income,
          SUM(CASE WHEN t.transaction_type_id = ${EXPENSE_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_expenses,
          SUM(CASE WHEN t.transaction_type_id = ${INVESTMENT_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_investments
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
  conditions.push(sql.raw(`t.transaction_type_id IN (${ACCOUNTING_TYPE_IDS.join(", ")})`));
  const where = whereFromConditions(conditions);

  const result = await db.execute(sql`
    SELECT
      SUM(CASE WHEN t.transaction_type_id = ${INCOME_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_income,
      SUM(CASE WHEN t.transaction_type_id = ${EXPENSE_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_expenses,
      SUM(CASE WHEN t.transaction_type_id = ${INVESTMENT_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS total_investments
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

const TO_DATE_LABEL_FORMATS: Record<string, string> = {
  day: "'DD Mon YYYY'",
  month: "'Mon YYYY'",
  quarter: "'\"Q\"Q YYYY'",
  year: "'YYYY'",
};

// Week needs a date range label, so we build the full SQL expression
function getLabelExpr(truncation: string, alias: string): string {
  if (truncation === "week") {
    return `to_char(${alias}, 'FMMM.FMDD.YYYY') || ' - ' || to_char(${alias} + interval '6 days', 'FMMM.FMDD.YYYY')`;
  }
  const fmt = TO_DATE_LABEL_FORMATS[truncation] ?? "'Mon YYYY'";
  return `to_char(${alias}, ${fmt})`;
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
  const curLabelExpr = getLabelExpr(truncation, "p.cur_start");
  const prevLabelExpr = getLabelExpr(truncation, "p.prev_start");

  // Use dateTo as reference date (or today)
  const refDate = safeDate(filters.dateTo) ?? new Date().toISOString().slice(0, 10);

  // Build optional filter conditions (excluding date range — we handle that ourselves)
  const extraConditions: SQL[] = [];
  if (filters.descriptions && filters.descriptions.length > 0) {
    const placeholders = filters.descriptions.map((d) => sql`${d}`);
    extraConditions.push(sql`t.transaction_description IN (${sql.join(placeholders, sql`, `)})`);
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    const placeholders = filters.accountIds.map((id) => sql`${id}`);
    extraConditions.push(sql`t.account_id IN (${sql.join(placeholders, sql`, `)})`);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const placeholders = filters.categoryIds.map((id) => sql`${id}`);
    extraConditions.push(sql`t.transaction_category_id IN (${sql.join(placeholders, sql`, `)})`);
  }
  extraConditions.push(sql.raw(`t.transaction_type_id IN (${ACCOUNTING_TYPE_IDS.join(", ")})`));

  const extraWhere = extraConditions.length > 0
    ? sql`AND ${sql.join(extraConditions, sql` AND `)}`
    : sql``;

  const result = await db.execute(sql`
    WITH params AS (
      SELECT
        date_trunc(${sql.raw(`'${truncation}'`)}, ${refDate}::date)::date AS cur_start,
        ${refDate}::date AS cur_end,
        (date_trunc(${sql.raw(`'${truncation}'`)}, ${refDate}::date) - interval ${sql.raw(`'${intervalStr}'`)})::date AS prev_start,
        (date_trunc(${sql.raw(`'${truncation}'`)}, ${refDate}::date) - interval '1 day')::date AS prev_end
    )
    SELECT
      SUM(CASE WHEN t.transaction_date >= p.cur_start AND t.transaction_date <= p.cur_end AND t.transaction_type_id = ${INCOME_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS cur_income,
      SUM(CASE WHEN t.transaction_date >= p.prev_start AND t.transaction_date <= p.prev_end AND t.transaction_type_id = ${INCOME_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS prev_income,
      SUM(CASE WHEN t.transaction_date >= p.cur_start AND t.transaction_date <= p.cur_end AND t.transaction_type_id = ${EXPENSE_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS cur_expenses,
      SUM(CASE WHEN t.transaction_date >= p.prev_start AND t.transaction_date <= p.prev_end AND t.transaction_type_id = ${EXPENSE_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS prev_expenses,
      SUM(CASE WHEN t.transaction_date >= p.cur_start AND t.transaction_date <= p.cur_end AND t.transaction_type_id = ${INVESTMENT_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS cur_investments,
      SUM(CASE WHEN t.transaction_date >= p.prev_start AND t.transaction_date <= p.prev_end AND t.transaction_type_id = ${INVESTMENT_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS prev_investments,
      MIN(${sql.raw(curLabelExpr)}) AS cur_label,
      MIN(${sql.raw(prevLabelExpr)}) AS prev_label
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
  conditions.push(sql.raw(`t.transaction_type_id = ${EXPENSE_TYPE.id}`));
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
  const extraConditions: SQL[] = [];
  if (filters.descriptions && filters.descriptions.length > 0) {
    const placeholders = filters.descriptions.map((d) => sql`${d}`);
    extraConditions.push(sql`t.transaction_description IN (${sql.join(placeholders, sql`, `)})`);
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    const placeholders = filters.accountIds.map((id) => sql`${id}`);
    extraConditions.push(sql`t.account_id IN (${sql.join(placeholders, sql`, `)})`);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const placeholders = filters.categoryIds.map((id) => sql`${id}`);
    extraConditions.push(sql`t.transaction_category_id IN (${sql.join(placeholders, sql`, `)})`);
  }
  extraConditions.push(sql.raw(`t.transaction_type_id IN (${ACCOUNTING_TYPE_IDS.join(", ")})`));

  const extraWhere = extraConditions.length > 0
    ? sql`AND ${sql.join(extraConditions, sql` AND `)}`
    : sql``;

  const result = await db.execute(sql`
    WITH monthly AS (
      SELECT
        date_trunc('month', t.transaction_date) AS month,
        SUM(CASE WHEN t.transaction_type_id = ${INCOME_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS income,
        SUM(CASE WHEN t.transaction_type_id = ${EXPENSE_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS expenses,
        SUM(CASE WHEN t.transaction_type_id = ${INVESTMENT_TYPE.id} THEN ABS(t.amount) ELSE 0 END) AS investments
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
