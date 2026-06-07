import { db } from "@/lib/db";
import { sql, type SQL } from "drizzle-orm";
import {
  DEBT_INTEREST_CATEGORY_IDS,
  DEBT_PAYMENT_CATEGORY_IDS,
  LIABILITY_CATEGORY_IDS,
  LIABILITY_CURRENT_CATEGORY_ID,
  LIABILITY_NON_CURRENT_CATEGORY_ID,
} from "@/lib/queries/liability-categories";
import { balanceAtDate } from "@/lib/queries/_aggregates";

// Sign convention: liability balances are stored as negative numbers in
// account_balance_history. We preserve that sign throughout — this module
// returns raw cumulative_balance values (negative for outstanding debt).
// Transaction sums also preserve their natural sign on the liability side:
// payments are positive (paydown moves balance toward zero), interest accruals
// are negative (added debt moves balance further from zero).

// Build a parameterized SQL fragment for `IN (...)` from a numeric tuple.
const inList = (ids: readonly number[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );

const LIABILITY_IDS = inList(LIABILITY_CATEGORY_IDS);
const PAYMENT_IDS = inList(DEBT_PAYMENT_CATEGORY_IDS);
const INTEREST_IDS = inList(DEBT_INTEREST_CATEGORY_IDS);
const DEBT_SERVICE_IDS = inList([
  ...DEBT_PAYMENT_CATEGORY_IDS,
  ...DEBT_INTEREST_CATEGORY_IDS,
]);

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

export interface LiabilityAllocationData {
  totalLiabilities: number;
  currentLiabilities: number;
  nonCurrentLiabilities: number;
  asOf: string;
  byCategory: AllocationCategory[];
}

export interface PerformanceAccount {
  accountId: number;
  accountName: string;
  currentValue: number;
  startValue: number;
  change: number;
  percentChange: number | null;
  percentOfParent: number;
  percentOfTotal: number;
}

export interface PerformanceAccountType {
  accountTypeId: number;
  accountTypeName: string;
  currentValue: number;
  startValue: number;
  change: number;
  percentChange: number | null;
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
  percentChange: number | null;
  percentOfTotal: number;
  accountTypes: PerformanceAccountType[];
}

export interface LiabilityPerformanceData {
  totalCurrentValue: number;
  totalStartValue: number;
  totalChange: number;
  totalPercentChange: number | null;
  categories: PerformanceCategory[];
}

export interface LiabilityDecompositionPoint {
  date: string;
  categoryId: number;
  categoryName: string;
  accountTypeId: number;
  accountTypeName: string;
  accountId: number;
  accountName: string;
  cumulativeBalance: number;
}

export interface DebtServiceAccount {
  accountId: number;
  accountName: string;
  totalPayments: number;
  interestAccrued: number;
  principalPaid: number;
}

export interface DebtServiceAccountType {
  accountTypeId: number;
  accountTypeName: string;
  totalPayments: number;
  interestAccrued: number;
  principalPaid: number;
  accounts: DebtServiceAccount[];
}

export interface DebtServiceCategory {
  categoryId: number;
  categoryName: string;
  totalPayments: number;
  interestAccrued: number;
  principalPaid: number;
  accountTypes: DebtServiceAccountType[];
}

export interface DebtServiceData {
  totalPayments: number;
  interestAccrued: number;
  principalPaid: number;
  categories: DebtServiceCategory[];
}

export interface DebtWaterfallData {
  startBalance: number;
  endBalance: number;
  payments: number;
  interestAccrued: number;
  other: number;
}

// ── Helpers ────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) =>
  den !== 0 ? round2((num / den) * 100) : 0;

// `% Change` is undefined when the start balance is zero (e.g. an account
// opened mid-period). Return null so the UI can render "—".
const pctOrNull = (num: number, den: number): number | null =>
  den !== 0 ? round2((num / den) * 100) : null;

// ── Queries ────────────────────────────────────────────────────────

/**
 * Snapshot of liability allocation as of `dateTo` (default: latest balance
 * date per account). Returns nested structure (category → account type)
 * suitable for a treemap. Values are negative magnitudes (raw balances).
 */
export async function getLiabilityAllocation(
  dateTo?: string
): Promise<LiabilityAllocationData> {
  // Accounts closed on or before the as-of date contribute nothing — their
  // last balance_history row is the day before closure (rebuild-balance.ts:33)
  // and would otherwise be picked up by the per-account MAX(balance_date).
  const asOfExpr = dateTo ? sql`${dateTo}::date` : sql`CURRENT_DATE`;
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
    WHERE atc.account_type_category_id IN (${LIABILITY_IDS})
      AND (a.closed_date IS NULL OR a.closed_date > ${asOfExpr})
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

  const totalLiabilities = Array.from(catMap.values()).reduce(
    (s, c) => s + c.value,
    0
  );
  const currentLiabilities = catMap.get(LIABILITY_CURRENT_CATEGORY_ID)?.value ?? 0;
  const nonCurrentLiabilities =
    catMap.get(LIABILITY_NON_CURRENT_CATEGORY_ID)?.value ?? 0;

  // Most-negative first (largest debt by magnitude).
  const byCategory: AllocationCategory[] = Array.from(catMap.values())
    .map((cat) => ({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      value: cat.value,
      percentOfTotal: pct(cat.value, totalLiabilities),
      children: cat.children
        .map((c) => ({
          accountTypeId: c.id,
          accountTypeName: c.name,
          value: c.value,
          percentOfParent: pct(c.value, cat.value),
          percentOfTotal: pct(c.value, totalLiabilities),
        }))
        .sort((a, b) => a.value - b.value),
    }))
    .sort((a, b) => a.value - b.value);

  return {
    totalLiabilities,
    currentLiabilities,
    nonCurrentLiabilities,
    asOf: asOf ?? "",
    byCategory,
  };
}

/**
 * Hierarchical period-over-period change (category → type → account) for
 * liability categories only. `change > 0` means the (negative) balance moved
 * toward zero — i.e. debt was paid down. `% Change` is computed against
 * `|startValue|` so its sign matches `change`: a paydown reads as `+X%`
 * (good, green) and a balance increase reads as `-X%` (bad, red). `% Change`
 * is `null` when the start balance is zero (new debt opened mid-period).
 */
export async function getLiabilityPerformance(
  dateFrom: string,
  dateTo?: string
): Promise<LiabilityPerformanceData> {
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
    WHERE atc.account_type_category_id IN (${LIABILITY_IDS})
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
                percentChange: pctOrNull(change, Math.abs(a.startValue)),
                percentOfParent: pct(a.currentValue, t.currentValue),
                percentOfTotal: pct(a.currentValue, totalCurrentValue),
              };
            })
            // Largest debt by magnitude first.
            .sort((x, y) => x.currentValue - y.currentValue);

          return {
            accountTypeId: t.accountTypeId,
            accountTypeName: t.accountTypeName,
            currentValue: t.currentValue,
            startValue: t.startValue,
            change: typeChange,
            percentChange: pctOrNull(typeChange, Math.abs(t.startValue)),
            percentOfParent: pct(t.currentValue, cat.currentValue),
            percentOfTotal: pct(t.currentValue, totalCurrentValue),
            accounts,
          };
        })
        .sort((x, y) => x.currentValue - y.currentValue);

      return {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        currentValue: cat.currentValue,
        startValue: cat.startValue,
        change: catChange,
        percentChange: pctOrNull(catChange, Math.abs(cat.startValue)),
        percentOfTotal: pct(cat.currentValue, totalCurrentValue),
        accountTypes,
      };
    })
    .sort((x, y) => x.currentValue - y.currentValue);

  return {
    totalCurrentValue,
    totalStartValue,
    totalChange,
    totalPercentChange: pctOrNull(totalChange, Math.abs(totalStartValue)),
    categories,
  };
}

/**
 * Daily cumulative balance per liability account, for the stacked
 * time-series decomposition chart. Values are negative magnitudes.
 */
export async function getLiabilityTrendDecomposition(
  dateFrom?: string,
  dateTo?: string
): Promise<LiabilityDecompositionPoint[]> {
  const conditions: SQL[] = [
    sql`atc.account_type_category_id IN (${LIABILITY_IDS})`,
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

/**
 * Aggregates payment and interest-accrual transactions on liability
 * accounts over the period. Returns a hierarchical structure (category →
 * account type → account) mirroring `getLiabilityPerformance`. Values
 * preserve their natural sign on the liability side: payments are positive
 * (paydown), interest is negative (added debt). `principalPaid =
 * totalPayments + interestAccrued` because the negative interest sum
 * subtracts the interest portion.
 */
export async function getDebtServiceSummary(
  dateFrom: string,
  dateTo?: string
): Promise<DebtServiceData> {
  const endDate = dateTo ?? sql`CURRENT_DATE`;

  const result = await db.execute(sql`
    SELECT
      atc.account_type_category_id AS category_id,
      atc.account_type_category AS category_name,
      at.account_type_id,
      at.account_type AS account_type_name,
      a.account_id,
      a.account_name,
      COALESCE(SUM(CASE WHEN t.transaction_category_id IN (${PAYMENT_IDS})
        THEN t.amount ELSE 0 END), 0) AS payments,
      COALESCE(SUM(CASE WHEN t.transaction_category_id IN (${INTEREST_IDS})
        THEN t.amount ELSE 0 END), 0) AS interest
    FROM transactions t
    JOIN accounts a ON a.account_id = t.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    JOIN account_type_categories atc
      ON atc.account_type_category_id = at.account_type_category_id
    WHERE atc.account_type_category_id IN (${LIABILITY_IDS})
      AND t.transaction_date BETWEEN ${dateFrom}::date AND ${endDate}::date
      AND t.transaction_category_id IN (${DEBT_SERVICE_IDS})
    GROUP BY
      atc.account_type_category_id, atc.account_type_category,
      at.account_type_id, at.account_type,
      a.account_id, a.account_name
    ORDER BY atc.account_type_category_id, at.account_type_id, a.account_name
  `);

  type Row = {
    category_id: number;
    category_name: string;
    account_type_id: number;
    account_type_name: string;
    account_id: number;
    account_name: string;
    payments: string;
    interest: string;
  };

  const rows = result.rows as Row[];

  const catMap = new Map<
    number,
    {
      categoryId: number;
      categoryName: string;
      totalPayments: number;
      interestAccrued: number;
      types: Map<
        number,
        {
          accountTypeId: number;
          accountTypeName: string;
          totalPayments: number;
          interestAccrued: number;
          accounts: DebtServiceAccount[];
        }
      >;
    }
  >();

  for (const row of rows) {
    const totalPayments = parseFloat(row.payments) || 0;
    const interestAccrued = parseFloat(row.interest) || 0;
    const principalPaid = totalPayments + interestAccrued;

    let cat = catMap.get(row.category_id);
    if (!cat) {
      cat = {
        categoryId: row.category_id,
        categoryName: row.category_name,
        totalPayments: 0,
        interestAccrued: 0,
        types: new Map(),
      };
      catMap.set(row.category_id, cat);
    }
    cat.totalPayments += totalPayments;
    cat.interestAccrued += interestAccrued;

    let type = cat.types.get(row.account_type_id);
    if (!type) {
      type = {
        accountTypeId: row.account_type_id,
        accountTypeName: row.account_type_name,
        totalPayments: 0,
        interestAccrued: 0,
        accounts: [],
      };
      cat.types.set(row.account_type_id, type);
    }
    type.totalPayments += totalPayments;
    type.interestAccrued += interestAccrued;
    type.accounts.push({
      accountId: row.account_id,
      accountName: row.account_name,
      totalPayments,
      interestAccrued,
      principalPaid,
    });
  }

  const categories: DebtServiceCategory[] = Array.from(catMap.values()).map(
    (cat) => ({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      totalPayments: cat.totalPayments,
      interestAccrued: cat.interestAccrued,
      principalPaid: cat.totalPayments + cat.interestAccrued,
      accountTypes: Array.from(cat.types.values()).map((t) => ({
        accountTypeId: t.accountTypeId,
        accountTypeName: t.accountTypeName,
        totalPayments: t.totalPayments,
        interestAccrued: t.interestAccrued,
        principalPaid: t.totalPayments + t.interestAccrued,
        accounts: t.accounts,
      })),
    })
  );

  const totalPayments = categories.reduce((s, c) => s + c.totalPayments, 0);
  const interestAccrued = categories.reduce(
    (s, c) => s + c.interestAccrued,
    0
  );

  return {
    totalPayments,
    interestAccrued,
    principalPaid: totalPayments + interestAccrued,
    categories,
  };
}

/**
 * Bridges start balance to end balance via payments, interest, and a
 * residual "other" bar that closes the difference. All values preserve
 * their natural sign on the liability side, so `start + payments +
 * interest + other = end` reconciles directly.
 */
export async function getDebtWaterfall(
  dateFrom: string,
  dateTo?: string
): Promise<DebtWaterfallData> {
  const endDate = dateTo ?? sql`CURRENT_DATE`;

  const balanceResult = await db.execute(sql`
    SELECT
      ${balanceAtDate(dateFrom, "start_balance")},
      ${balanceAtDate(endDate, "end_balance")}
    FROM account_balance_history abh
    JOIN accounts a ON a.account_id = abh.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    WHERE at.account_type_category_id IN (${LIABILITY_IDS})
      AND abh.balance_date IN (${dateFrom}::date, ${endDate}::date)
  `);

  const balanceRow = (balanceResult.rows as {
    start_balance: string;
    end_balance: string;
  }[])[0];
  const startBalance = parseFloat(balanceRow?.start_balance) || 0;
  const endBalance = parseFloat(balanceRow?.end_balance) || 0;

  const txResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN t.transaction_category_id IN (${PAYMENT_IDS})
        THEN t.amount ELSE 0 END), 0) AS payments,
      COALESCE(SUM(CASE WHEN t.transaction_category_id IN (${INTEREST_IDS})
        THEN t.amount ELSE 0 END), 0) AS interest
    FROM transactions t
    JOIN accounts a ON a.account_id = t.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    WHERE at.account_type_category_id IN (${LIABILITY_IDS})
      AND t.transaction_date BETWEEN ${dateFrom}::date AND ${endDate}::date
  `);

  const txRow = (txResult.rows as { payments: string; interest: string }[])[0];
  const payments = parseFloat(txRow?.payments) || 0;
  const interestAccrued = parseFloat(txRow?.interest) || 0;

  const other = endBalance - startBalance - payments - interestAccrued;

  return {
    startBalance,
    endBalance,
    payments,
    interestAccrued,
    other,
  };
}
