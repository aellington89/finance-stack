import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// Category IDs
const NET_WORTH_EXCLUDED_CATEGORY_ID = 2; // Restricted Asset excluded from net worth

// ── Types ──────────────────────────────────────────────────────────

export interface WaterfallCategory {
  categoryId: number;
  categoryName: string;
  startBalance: number;
  endBalance: number;
  change: number;
}

export interface WaterfallData {
  startNetWorth: number;
  endNetWorth: number;
  categories: WaterfallCategory[];
}

export interface DriverRow {
  categoryId: number;
  categoryName: string;
  change: number;
  percentImpact: number;
}

export interface DriversData {
  totalChange: number;
  categories: DriverRow[];
}

export interface DecompositionPoint {
  date: string;
  categoryId: number;
  categoryName: string;
  accountId: number;
  accountName: string;
  cumulativeBalance: number;
}

// ── Queries ────────────────────────────────────────────────────────

/**
 * Compares cumulative balances at the start and end of a period,
 * grouped by account type category. Returns the per-category change
 * and overall start/end net worth.
 */
export async function getNetWorthWaterfall(
  dateFrom: string,
  dateTo?: string
): Promise<WaterfallData> {
  const endDate = dateTo ?? sql`CURRENT_DATE`;

  const result = await db.execute(sql`
    SELECT
      atc.account_type_category_id AS category_id,
      atc.account_type_category AS category_name,
      COALESCE(SUM(CASE WHEN abh.balance_date = ${dateFrom}::date
        THEN abh.cumulative_balance ELSE 0 END), 0) AS start_balance,
      COALESCE(SUM(CASE WHEN abh.balance_date = ${endDate}::date
        THEN abh.cumulative_balance ELSE 0 END), 0) AS end_balance
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc
      ON atc.account_type_category_id = at.account_type_category_id
    WHERE atc.account_type_category_id != ${NET_WORTH_EXCLUDED_CATEGORY_ID}
      AND abh.balance_date IN (${dateFrom}::date, ${endDate}::date)
    GROUP BY atc.account_type_category_id, atc.account_type_category
    ORDER BY atc.account_type_category_id
  `);

  type Row = {
    category_id: number;
    category_name: string;
    start_balance: string;
    end_balance: string;
  };

  const rows = result.rows as Row[];

  const categories: WaterfallCategory[] = rows.map((row) => {
    const startBalance = parseFloat(row.start_balance) || 0;
    const endBalance = parseFloat(row.end_balance) || 0;
    return {
      categoryId: row.category_id,
      categoryName: row.category_name,
      startBalance,
      endBalance,
      change: endBalance - startBalance,
    };
  });

  const startNetWorth = categories.reduce((sum, c) => sum + c.startBalance, 0);
  const endNetWorth = categories.reduce((sum, c) => sum + c.endBalance, 0);

  return { startNetWorth, endNetWorth, categories };
}

/**
 * Returns the same per-category change data as the waterfall, plus
 * a percent-impact column showing each category's share of the total
 * net worth change.
 */
export async function getNetWorthDrivers(
  dateFrom: string,
  dateTo?: string
): Promise<DriversData> {
  const waterfall = await getNetWorthWaterfall(dateFrom, dateTo);
  const totalChange = waterfall.endNetWorth - waterfall.startNetWorth;

  const categories: DriverRow[] = waterfall.categories.map((c) => ({
    categoryId: c.categoryId,
    categoryName: c.categoryName,
    change: c.change,
    percentImpact:
      totalChange !== 0
        ? Math.round((c.change / totalChange) * 10000) / 100
        : 0,
  }));

  return { totalChange, categories };
}

/**
 * Returns daily cumulative balances broken down by both account type
 * category and individual account, for the trend decomposition chart.
 */
export async function getNetWorthTrendDecomposition(
  dateFrom?: string,
  dateTo?: string
): Promise<DecompositionPoint[]> {
  const conditions = [
    sql`atc.account_type_category_id != ${NET_WORTH_EXCLUDED_CATEGORY_ID}`,
  ];

  if (dateFrom) {
    conditions.push(sql`abh.balance_date >= ${dateFrom}`);
  }
  if (dateTo) {
    conditions.push(sql`abh.balance_date <= ${dateTo}`);
  }

  const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

  const result = await db.execute(sql`
    SELECT
      abh.balance_date AS date,
      atc.account_type_category_id AS category_id,
      atc.account_type_category AS category_name,
      a.account_id,
      a.account_name,
      abh.cumulative_balance
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc
      ON atc.account_type_category_id = at.account_type_category_id
    ${whereClause}
    ORDER BY abh.balance_date ASC, atc.account_type_category_id, a.account_id
  `);

  type Row = {
    date: string;
    category_id: number;
    category_name: string;
    account_id: number;
    account_name: string;
    cumulative_balance: string;
  };

  return (result.rows as Row[]).map((row) => ({
    date: row.date,
    categoryId: row.category_id,
    categoryName: row.category_name,
    accountId: row.account_id,
    accountName: row.account_name,
    cumulativeBalance: parseFloat(row.cumulative_balance) || 0,
  }));
}
