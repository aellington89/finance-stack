import type {
  PerformanceAccountType,
  PerformanceCategory,
  PerformanceData,
} from "@/lib/queries/assets-drilldown";
import { pct, pctOrNull } from "@/lib/queries/_percent";

/**
 * One row of getAssetPerformance's query: a single asset account with its
 * cumulative balance on the period's start and end dates. `start_balance` and
 * `end_balance` are pg `numeric`, so they arrive as strings.
 *
 * A `type` rather than an `interface` on purpose: only a type alias gets the
 * implicit index signature that lets the query cast `db.execute`'s
 * `Record<string, unknown>[]` to it.
 */
export type AssetPerformanceRow = {
  category_id: number;
  category_name: string;
  account_type_id: number;
  account_type_name: string;
  account_id: number;
  account_name: string;
  start_balance: string;
  end_balance: string;
};

/**
 * Rolls per-account start/end balances up into the category → type → account
 * tree the Asset Performance table renders (Issue #143).
 *
 * Kept apart from assets-drilldown.ts, and free of any database import, so
 * the unit project can reach every edge case directly — the integration suite
 * can only get here through real rows in Finances_Test. getAssetPerformance is
 * now the query plus a call to this.
 *
 * `% Change` divides by `|startValue|`, as getLiabilityPerformance does, so it
 * always has the sign of `change`. Dividing by the signed start made an
 * overdrawn account's recovery (-$100 → +$50) read -150%, drawn red with a
 * down arrow. A zero start (an account opened mid-period) gives `null`, which
 * the table shows as "—" rather than a misleading 0.00%. The share columns
 * keep `pct`: a share of a zero parent is 0.
 *
 * Every level is sorted by `currentValue`, largest first; ties keep row order.
 */
export function buildAssetPerformance(
  rows: readonly AssetPerformanceRow[]
): PerformanceData {
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
            .sort((x, y) => y.currentValue - x.currentValue);

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
        .sort((x, y) => y.currentValue - x.currentValue);

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
    .sort((x, y) => y.currentValue - x.currentValue);

  return {
    totalCurrentValue,
    totalStartValue,
    totalChange,
    totalPercentChange: pctOrNull(totalChange, Math.abs(totalStartValue)),
    categories,
  };
}
