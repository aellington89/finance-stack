import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { balanceAtDate } from "@/lib/queries/_aggregates";

// Asset categories: Current Asset (1), Restricted Asset (2), Fixed Asset (3),
// Investment (4). Liabilities (5, 6) are excluded. Restricted is kept in the
// asset total to match getCurrentNetWorth().totalAssets, and surfaced as its
// own bucket by the liquidity breakdown.
const ASSET_CATEGORY_IDS = [1, 2, 3, 4] as const;

export type LiquidityClass =
  | "liquid"
  | "semi_liquid"
  | "illiquid"
  | "restricted"
  | "unclassified";

// ── Types ──────────────────────────────────────────────────────────

export interface AllocationAccountType {
  accountTypeId: number;
  accountTypeName: string;
  value: number;
  percentOfParent: number;
  percentOfTotal: number;
}

export interface AllocationCategory {
  categoryId: number;
  categoryName: string;
  value: number;
  percentOfTotal: number;
  children: AllocationAccountType[];
}

export interface AllocationData {
  totalAssets: number;
  asOf: string;
  byCategory: AllocationCategory[];
}

export interface PerformanceAccount {
  accountId: number;
  accountName: string;
  currentValue: number;
  startValue: number;
  change: number;
  percentChange: number;
  percentOfParent: number;
  percentOfTotal: number;
}

export interface PerformanceAccountType {
  accountTypeId: number;
  accountTypeName: string;
  currentValue: number;
  startValue: number;
  change: number;
  percentChange: number;
  percentOfParent: number;
  percentOfTotal: number;
  accounts: PerformanceAccount[];
}

export interface PerformanceCategory {
  categoryId: number;
  categoryName: string;
  currentValue: number;
  startValue: number;
  change: number;
  percentChange: number;
  percentOfTotal: number;
  accountTypes: PerformanceAccountType[];
}

export interface PerformanceData {
  totalCurrentValue: number;
  totalStartValue: number;
  totalChange: number;
  totalPercentChange: number;
  categories: PerformanceCategory[];
}

export interface LiquidityBucket {
  liquidityClass: LiquidityClass;
  value: number;
  percent: number;
}

export interface LiquidityData {
  total: number;
  asOf: string;
  classes: LiquidityBucket[];
}

export interface AssetDecompositionPoint {
  date: string;
  categoryId: number;
  categoryName: string;
  accountTypeId: number;
  accountTypeName: string;
  accountId: number;
  accountName: string;
  liquidityClass: LiquidityClass;
  cumulativeBalance: number;
}

// ── Helpers ────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) =>
  den !== 0 ? round2((num / den) * 100) : 0;

const normalizeLiquidity = (raw: string | null): LiquidityClass => {
  if (
    raw === "liquid" ||
    raw === "semi_liquid" ||
    raw === "illiquid" ||
    raw === "restricted"
  ) {
    return raw;
  }
  return "unclassified";
};

// ── Queries ────────────────────────────────────────────────────────

/**
 * Snapshot of asset allocation as of `dateTo` (default: latest balance date
 * per account). Returns nested structure suitable for feeding a treemap
 * (category → account type).
 */
export async function getAssetAllocation(
  dateTo?: string
): Promise<AllocationData> {
  const dateFilter = dateTo
    ? sql`abh.balance_date = ${dateTo}::date`
    : sql`abh.balance_date = (
        SELECT MAX(balance_date) FROM account_balance_history
        WHERE account_id = abh.account_id
      )`;

  const result = await db.execute(sql`
    SELECT
      atc.account_type_category_id AS category_id,
      atc.account_type_category AS category_name,
      at.account_type_id,
      at.account_type AS account_type_name,
      MAX(abh.balance_date) AS as_of,
      COALESCE(SUM(abh.cumulative_balance), 0) AS value
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc
      ON atc.account_type_category_id = at.account_type_category_id
    WHERE atc.account_type_category_id IN (1, 2, 3, 4)
      AND ${dateFilter}
    GROUP BY
      atc.account_type_category_id, atc.account_type_category,
      at.account_type_id, at.account_type
    ORDER BY atc.account_type_category_id, at.account_type_id
  `);

  type Row = {
    category_id: number;
    category_name: string;
    account_type_id: number;
    account_type_name: string;
    as_of: string | null;
    value: string;
  };

  const rows = result.rows as Row[];

  const catMap = new Map<
    number,
    {
      categoryId: number;
      categoryName: string;
      value: number;
      children: { id: number; name: string; value: number }[];
    }
  >();

  let asOf: string | null = null;

  for (const row of rows) {
    const value = parseFloat(row.value) || 0;
    if (row.as_of && (!asOf || row.as_of > asOf)) {
      asOf = row.as_of;
    }

    let cat = catMap.get(row.category_id);
    if (!cat) {
      cat = {
        categoryId: row.category_id,
        categoryName: row.category_name,
        value: 0,
        children: [],
      };
      catMap.set(row.category_id, cat);
    }
    cat.value += value;
    cat.children.push({
      id: row.account_type_id,
      name: row.account_type_name,
      value,
    });
  }

  const totalAssets = Array.from(catMap.values()).reduce(
    (s, c) => s + c.value,
    0
  );

  const byCategory: AllocationCategory[] = Array.from(catMap.values()).map(
    (cat) => ({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      value: cat.value,
      percentOfTotal: pct(cat.value, totalAssets),
      children: cat.children
        .map((c) => ({
          accountTypeId: c.id,
          accountTypeName: c.name,
          value: c.value,
          percentOfParent: pct(c.value, cat.value),
          percentOfTotal: pct(c.value, totalAssets),
        }))
        .sort((a, b) => b.value - a.value),
    })
  );

  byCategory.sort((a, b) => b.value - a.value);

  return {
    totalAssets,
    asOf: asOf ?? "",
    byCategory,
  };
}

/**
 * Hierarchical period-over-period change (category → type → account) for
 * asset categories only. "Return" is proxied by cumulative_balance delta;
 * the schema does not track cost basis.
 */
export async function getAssetPerformance(
  dateFrom: string,
  dateTo?: string
): Promise<PerformanceData> {
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
    WHERE atc.account_type_category_id IN (1, 2, 3, 4)
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

  const catMap = new Map<
    number,
    {
      categoryId: number;
      categoryName: string;
      currentValue: number;
      startValue: number;
      types: Map<
        number,
        {
          accountTypeId: number;
          accountTypeName: string;
          currentValue: number;
          startValue: number;
          accounts: {
            accountId: number;
            accountName: string;
            currentValue: number;
            startValue: number;
          }[];
        }
      >;
    }
  >();

  for (const row of rows) {
    const startValue = parseFloat(row.start_balance) || 0;
    const currentValue = parseFloat(row.end_balance) || 0;

    let cat = catMap.get(row.category_id);
    if (!cat) {
      cat = {
        categoryId: row.category_id,
        categoryName: row.category_name,
        currentValue: 0,
        startValue: 0,
        types: new Map(),
      };
      catMap.set(row.category_id, cat);
    }
    cat.currentValue += currentValue;
    cat.startValue += startValue;

    let type = cat.types.get(row.account_type_id);
    if (!type) {
      type = {
        accountTypeId: row.account_type_id,
        accountTypeName: row.account_type_name,
        currentValue: 0,
        startValue: 0,
        accounts: [],
      };
      cat.types.set(row.account_type_id, type);
    }
    type.currentValue += currentValue;
    type.startValue += startValue;
    type.accounts.push({
      accountId: row.account_id,
      accountName: row.account_name,
      currentValue,
      startValue,
    });
  }

  const totalCurrentValue = Array.from(catMap.values()).reduce(
    (s, c) => s + c.currentValue,
    0
  );
  const totalStartValue = Array.from(catMap.values()).reduce(
    (s, c) => s + c.startValue,
    0
  );
  const totalChange = totalCurrentValue - totalStartValue;

  const categories: PerformanceCategory[] = Array.from(catMap.values())
    .map((cat) => {
      const catChange = cat.currentValue - cat.startValue;

      const accountTypes: PerformanceAccountType[] = Array.from(
        cat.types.values()
      )
        .map((t) => {
          const typeChange = t.currentValue - t.startValue;

          const accounts = t.accounts
            .map((a) => {
              const change = a.currentValue - a.startValue;
              return {
                accountId: a.accountId,
                accountName: a.accountName,
                currentValue: a.currentValue,
                startValue: a.startValue,
                change,
                percentChange: pct(change, a.startValue),
                percentOfParent: pct(a.currentValue, t.currentValue),
                percentOfTotal: pct(a.currentValue, totalCurrentValue),
              };
            })
            .sort((x, y) => y.currentValue - x.currentValue);

          return {
            accountTypeId: t.accountTypeId,
            accountTypeName: t.accountTypeName,
            currentValue: t.currentValue,
            startValue: t.startValue,
            change: typeChange,
            percentChange: pct(typeChange, t.startValue),
            percentOfParent: pct(t.currentValue, cat.currentValue),
            percentOfTotal: pct(t.currentValue, totalCurrentValue),
            accounts,
          };
        })
        .sort((x, y) => y.currentValue - x.currentValue);

      return {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        currentValue: cat.currentValue,
        startValue: cat.startValue,
        change: catChange,
        percentChange: pct(catChange, cat.startValue),
        percentOfTotal: pct(cat.currentValue, totalCurrentValue),
        accountTypes,
      };
    })
    .sort((x, y) => y.currentValue - x.currentValue);

  return {
    totalCurrentValue,
    totalStartValue,
    totalChange,
    totalPercentChange: pct(totalChange, totalStartValue),
    categories,
  };
}

/**
 * Buckets current asset balances by effective liquidity class, using
 * COALESCE(a.liquidity_class, at.liquidity_class) so per-account overrides
 * take precedence over the type default. Accounts with no classification
 * at either level roll up into the "unclassified" bucket.
 */
export async function getLiquidityBreakdown(
  dateTo?: string
): Promise<LiquidityData> {
  const dateFilter = dateTo
    ? sql`abh.balance_date = ${dateTo}::date`
    : sql`abh.balance_date = (
        SELECT MAX(balance_date) FROM account_balance_history
        WHERE account_id = abh.account_id
      )`;

  const result = await db.execute(sql`
    SELECT
      COALESCE(a.liquidity_class, at.liquidity_class) AS liquidity_class,
      MAX(abh.balance_date) AS as_of,
      COALESCE(SUM(abh.cumulative_balance), 0) AS value
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc
      ON atc.account_type_category_id = at.account_type_category_id
    WHERE atc.account_type_category_id IN (1, 2, 3, 4)
      AND ${dateFilter}
    GROUP BY COALESCE(a.liquidity_class, at.liquidity_class)
  `);

  type Row = {
    liquidity_class: string | null;
    as_of: string | null;
    value: string;
  };

  const rows = result.rows as Row[];

  const bucketMap = new Map<LiquidityClass, number>();
  let asOf: string | null = null;

  for (const row of rows) {
    const klass = normalizeLiquidity(row.liquidity_class);
    const value = parseFloat(row.value) || 0;
    bucketMap.set(klass, (bucketMap.get(klass) ?? 0) + value);
    if (row.as_of && (!asOf || row.as_of > asOf)) {
      asOf = row.as_of;
    }
  }

  const total = Array.from(bucketMap.values()).reduce((s, v) => s + v, 0);

  const order: LiquidityClass[] = [
    "liquid",
    "semi_liquid",
    "illiquid",
    "restricted",
    "unclassified",
  ];

  const classes: LiquidityBucket[] = order
    .filter((k) => bucketMap.has(k))
    .map((k) => {
      const value = bucketMap.get(k) ?? 0;
      return {
        liquidityClass: k,
        value,
        percent: pct(value, total),
      };
    });

  return {
    total,
    asOf: asOf ?? "",
    classes,
  };
}

/**
 * Daily cumulative balance per account, for the stacked time-series
 * decomposition chart. Scoped to asset categories (1,2,3,4).
 */
export async function getAssetTrendDecomposition(
  dateFrom?: string,
  dateTo?: string
): Promise<AssetDecompositionPoint[]> {
  const conditions = [
    sql`atc.account_type_category_id IN (1, 2, 3, 4)`,
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
      COALESCE(a.liquidity_class, at.liquidity_class) AS liquidity_class,
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
    liquidity_class: string | null;
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
    liquidityClass: normalizeLiquidity(row.liquidity_class),
    cumulativeBalance: parseFloat(row.cumulative_balance) || 0,
  }));
}

// Exported for consumers that want to iterate on a known-exhaustive list.
export const ASSET_CATEGORY_ID_LIST = ASSET_CATEGORY_IDS;
