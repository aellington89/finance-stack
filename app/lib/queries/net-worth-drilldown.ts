import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { RESTRICTED_ASSET_CATEGORY } from "@/lib/constants/reference-ids";
import { balanceAtDate } from "@/lib/queries/_aggregates";

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

export interface DriverAccount {
  accountId: number;
  accountName: string;
  change: number;
  percentOfParent: number;
  percentOfTotal: number;
}

export interface DriverAccountType {
  accountTypeId: number;
  accountTypeName: string;
  change: number;
  percentOfParent: number;
  percentOfTotal: number;
  accounts: DriverAccount[];
}

export interface DriverCategory {
  categoryId: number;
  categoryName: string;
  change: number;
  percentOfTotal: number;
  accountTypes: DriverAccountType[];
}

export interface DriversData {
  totalChange: number;
  categories: DriverCategory[];
}

export interface DecompositionPoint {
  date: string;
  categoryId: number;
  categoryName: string;
  accountTypeId: number;
  accountTypeName: string;
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
      ${balanceAtDate(dateFrom, "start_balance")},
      ${balanceAtDate(endDate, "end_balance")}
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc
      ON atc.account_type_category_id = at.account_type_category_id
    WHERE atc.account_type_category_id != ${RESTRICTED_ASSET_CATEGORY.id}
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
  const endDate = dateTo ?? sql`CURRENT_DATE`;

  const result = await db.execute(sql`
    SELECT
      atc.account_type_category_id AS category_id,
      atc.account_type_category AS category_name,
      at.account_type_id,
      at.account_type AS account_type_name,
      a.account_id,
      a.account_name,
      ${balanceAtDate(dateFrom, "start_balance")},
      ${balanceAtDate(endDate, "end_balance")}
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc
      ON atc.account_type_category_id = at.account_type_category_id
    WHERE atc.account_type_category_id != ${RESTRICTED_ASSET_CATEGORY.id}
      AND abh.balance_date IN (${dateFrom}::date, ${endDate}::date)
    GROUP BY
      atc.account_type_category_id, atc.account_type_category,
      at.account_type_id, at.account_type,
      a.account_id, a.account_name
    ORDER BY atc.account_type_category_id, at.account_type_id, a.account_id
  `);

  type Row = {
    category_id: number;
    category_name: string;
    account_type_id: number;
    account_type_name: string;
    account_id: number;
    account_name: string;
    start_balance: string;
    end_balance: string;
  };

  const rows = result.rows as Row[];

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const pct = (num: number, den: number) =>
    den !== 0 ? round2((num / den) * 100) : 0;

  const catMap = new Map<
    number,
    {
      categoryId: number;
      categoryName: string;
      change: number;
      types: Map<
        number,
        {
          accountTypeId: number;
          accountTypeName: string;
          change: number;
          accounts: DriverAccount[];
        }
      >;
    }
  >();

  for (const row of rows) {
    const start = parseFloat(row.start_balance) || 0;
    const end = parseFloat(row.end_balance) || 0;
    const change = end - start;

    let cat = catMap.get(row.category_id);
    if (!cat) {
      cat = {
        categoryId: row.category_id,
        categoryName: row.category_name,
        change: 0,
        types: new Map(),
      };
      catMap.set(row.category_id, cat);
    }
    cat.change += change;

    let type = cat.types.get(row.account_type_id);
    if (!type) {
      type = {
        accountTypeId: row.account_type_id,
        accountTypeName: row.account_type_name,
        change: 0,
        accounts: [],
      };
      cat.types.set(row.account_type_id, type);
    }
    type.change += change;
    type.accounts.push({
      accountId: row.account_id,
      accountName: row.account_name,
      change,
      percentOfParent: 0,
      percentOfTotal: 0,
    });
  }

  const totalChange = Array.from(catMap.values()).reduce(
    (s, c) => s + c.change,
    0
  );

  const categories: DriverCategory[] = Array.from(catMap.values()).map(
    (cat) => {
      const accountTypes: DriverAccountType[] = Array.from(
        cat.types.values()
      ).map((t) => {
        const accounts = t.accounts
          .map((a) => ({
            ...a,
            percentOfParent: pct(a.change, t.change),
            percentOfTotal: pct(a.change, totalChange),
          }))
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

        return {
          accountTypeId: t.accountTypeId,
          accountTypeName: t.accountTypeName,
          change: t.change,
          percentOfParent: pct(t.change, cat.change),
          percentOfTotal: pct(t.change, totalChange),
          accounts,
        };
      });

      accountTypes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

      return {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        change: cat.change,
        percentOfTotal: pct(cat.change, totalChange),
        accountTypes,
      };
    }
  );

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
    sql`atc.account_type_category_id != ${RESTRICTED_ASSET_CATEGORY.id}`,
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
      at.account_type_id,
      at.account_type AS account_type_name,
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
    account_type_id: number;
    account_type_name: string;
    account_id: number;
    account_name: string;
    cumulative_balance: string;
  };

  return (result.rows as Row[]).map((row) => ({
    date: row.date,
    categoryId: row.category_id,
    categoryName: row.category_name,
    accountTypeId: row.account_type_id,
    accountTypeName: row.account_type_name,
    accountId: row.account_id,
    accountName: row.account_name,
    cumulativeBalance: parseFloat(row.cumulative_balance) || 0,
  }));
}
