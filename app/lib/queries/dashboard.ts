import { db } from "@/lib/db";
import { sql, type SQL } from "drizzle-orm";

export interface TimeSeriesPoint {
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface NetWorthSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

// Category IDs
const ASSET_CATEGORY_IDS = [1, 2, 3, 4]; // Current, Restricted, Fixed, Investment
const LIABILITY_CATEGORY_IDS = [5, 6]; // Current Liability, Non-current Liability
const NET_WORTH_EXCLUDED_CATEGORY_ID = 2; // Restricted Asset excluded from net worth

export async function getCurrentNetWorth(): Promise<NetWorthSummary> {
  // All three metrics use today's cumulative_balance snapshot.
  // Total Assets: categories 1,2,3,4 (all asset types)
  // Total Liabilities: categories 5,6 (current outstanding debt)
  // Net Worth: all categories except Restricted Asset (2)
  const result = await db.execute(sql`
    SELECT
      SUM(CASE
        WHEN at.account_type_category_id IN (1, 2, 3, 4)
        THEN abh.cumulative_balance ELSE 0
      END) AS total_assets,
      SUM(CASE
        WHEN at.account_type_category_id IN (5, 6)
        THEN abh.cumulative_balance ELSE 0
      END) AS total_liabilities,
      SUM(CASE
        WHEN at.account_type_category_id != ${NET_WORTH_EXCLUDED_CATEGORY_ID}
        THEN abh.cumulative_balance ELSE 0
      END) AS net_worth
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    WHERE abh.balance_date = CURRENT_DATE
  `);

  const row = (result.rows as { total_assets: string; total_liabilities: string; net_worth: string }[])[0];

  return {
    totalAssets: parseFloat(row?.total_assets) || 0,
    totalLiabilities: parseFloat(row?.total_liabilities) || 0,
    netWorth: parseFloat(row?.net_worth) || 0,
  };
}

export async function getNetWorthTimeSeries(
  dateFrom?: string,
  dateTo?: string
): Promise<TimeSeriesPoint[]> {
  const conditions: SQL[] = [];

  if (dateFrom) {
    conditions.push(sql`abh.balance_date >= ${dateFrom}`);
  }
  if (dateTo) {
    conditions.push(sql`abh.balance_date <= ${dateTo}`);
  }

  const whereClause =
    conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

  const result = await db.execute(sql`
    SELECT
      abh.balance_date AS date,
      SUM(CASE
        WHEN at.account_type_category_id IN (1, 2, 3, 4)
        THEN abh.cumulative_balance ELSE 0
      END) AS total_assets,
      SUM(CASE
        WHEN at.account_type_category_id IN (5, 6)
        THEN abh.cumulative_balance ELSE 0
      END) AS total_liabilities,
      SUM(CASE
        WHEN at.account_type_category_id != ${NET_WORTH_EXCLUDED_CATEGORY_ID}
        THEN abh.cumulative_balance ELSE 0
      END) AS net_worth
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc ON atc.account_type_category_id = at.account_type_category_id
    ${whereClause}
    GROUP BY abh.balance_date
    ORDER BY abh.balance_date ASC
  `);

  return (result.rows as { date: string; total_assets: string; total_liabilities: string; net_worth: string }[]).map(
    (row) => ({
      date: row.date,
      totalAssets: parseFloat(row.total_assets) || 0,
      totalLiabilities: parseFloat(row.total_liabilities) || 0,
      netWorth: parseFloat(row.net_worth) || 0,
    })
  );
}
