import { db } from "@/lib/db";
import { sql, type SQL } from "drizzle-orm";
import type { CategoryBreakdown } from "@/lib/queries/accounting";

// ── Types ──

export interface WorkExpenseFilters {
  dateFrom?: string;
  dateTo?: string;
}

export interface WorkExpenseTotals {
  totalWorkExpenses: number;
  totalReimbursements: number;
}

export interface WorkExpenseTimeSeriesPoint {
  date: string;
  totalExpenses: number;
  totalReimbursements: number;
}


// ── Constants ──

const WORK_EXPENSE_TYPE_ID = 5;
const REIMBURSEMENT_TYPE_ID = 6;
const WORK_EXPENSE_TYPE_IDS = [WORK_EXPENSE_TYPE_ID, REIMBURSEMENT_TYPE_ID];

// ── Helpers ──

function buildDateConditions(filters: WorkExpenseFilters, tableAlias = "t"): SQL[] {
  const conditions: SQL[] = [];
  if (filters.dateFrom) {
    conditions.push(sql.raw(`${tableAlias}.transaction_date >= '${filters.dateFrom}'`));
  }
  if (filters.dateTo) {
    conditions.push(sql.raw(`${tableAlias}.transaction_date <= '${filters.dateTo}'`));
  }
  return conditions;
}

function whereFromConditions(conditions: SQL[]): SQL {
  if (conditions.length === 0) return sql``;
  return sql`WHERE ${sql.join(conditions, sql` AND `)}`;
}

// ── Query A: Period Totals ──

export async function getWorkExpenseTotals(
  filters: WorkExpenseFilters
): Promise<WorkExpenseTotals> {
  const conditions = buildDateConditions(filters);
  conditions.push(sql.raw(`t.transaction_type_id IN (${WORK_EXPENSE_TYPE_IDS.join(", ")})`));
  const where = whereFromConditions(conditions);

  const result = await db.execute(sql`
    SELECT
      SUM(CASE WHEN t.transaction_type_id = ${WORK_EXPENSE_TYPE_ID} THEN ABS(t.amount) ELSE 0 END) AS total_work_expenses,
      SUM(CASE WHEN t.transaction_type_id = ${REIMBURSEMENT_TYPE_ID} THEN ABS(t.amount) ELSE 0 END) AS total_reimbursements
    FROM transactions t
    ${where}
  `);

  const row = (result.rows as { total_work_expenses: string; total_reimbursements: string }[])[0];
  return {
    totalWorkExpenses: parseFloat(row?.total_work_expenses) || 0,
    totalReimbursements: parseFloat(row?.total_reimbursements) || 0,
  };
}

// ── Query B: Time Series (monthly expenses vs reimbursements) ──

export async function getWorkExpenseTimeSeries(
  filters: WorkExpenseFilters
): Promise<WorkExpenseTimeSeriesPoint[]> {
  const dateFrom = filters.dateFrom ?? new Date().toISOString().slice(0, 10);
  const dateTo = filters.dateTo ?? new Date().toISOString().slice(0, 10);

  const result = await db.execute(sql`
    WITH series AS (
      SELECT date_trunc('month', d)::date AS date
      FROM generate_series(
        date_trunc('month', ${dateFrom}::date)::date,
        ${dateTo}::date,
        '1 month'::interval
      ) AS d
    ),
    agg AS (
      SELECT
        date_trunc('month', t.transaction_date)::date AS date,
        SUM(CASE WHEN t.transaction_type_id = ${WORK_EXPENSE_TYPE_ID} THEN ABS(t.amount) ELSE 0 END) AS total_expenses,
        SUM(CASE WHEN t.transaction_type_id = ${REIMBURSEMENT_TYPE_ID} THEN ABS(t.amount) ELSE 0 END) AS total_reimbursements
      FROM transactions t
      WHERE t.transaction_date >= date_trunc('month', ${dateFrom}::date)::date
        AND t.transaction_date <= ${dateTo}::date
        AND t.transaction_type_id IN (${sql.raw(WORK_EXPENSE_TYPE_IDS.join(", "))})
      GROUP BY 1
    )
    SELECT
      s.date::text,
      COALESCE(a.total_expenses, 0) AS total_expenses,
      COALESCE(a.total_reimbursements, 0) AS total_reimbursements
    FROM series s
    LEFT JOIN agg a ON a.date = s.date
    ORDER BY s.date ASC
  `);

  return (result.rows as { date: string; total_expenses: string; total_reimbursements: string }[]).map((row) => ({
    date: row.date,
    totalExpenses: parseFloat(row.total_expenses) || 0,
    totalReimbursements: parseFloat(row.total_reimbursements) || 0,
  }));
}

// ── Query C: Category Breakdown (work expenses only) ──

export async function getWorkExpenseCategoryBreakdown(
  filters: WorkExpenseFilters
): Promise<CategoryBreakdown[]> {
  const conditions = buildDateConditions(filters);
  conditions.push(sql.raw(`t.transaction_type_id = ${WORK_EXPENSE_TYPE_ID}`));
  const where = whereFromConditions(conditions);

  const result = await db.execute(sql`
    SELECT
      COALESCE(tc.transaction_category, 'Uncategorized') AS category,
      SUM(ABS(t.amount)) AS total
    FROM transactions t
    LEFT JOIN transaction_categories tc USING (transaction_category_id)
    ${where}
    GROUP BY category
    ORDER BY total DESC
  `);

  return (result.rows as { category: string; total: string }[]).map((row) => ({
    category: row.category,
    total: parseFloat(row.total) || 0,
  }));
}
