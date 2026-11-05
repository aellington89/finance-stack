import type {
  DriverAccount,
  DriverAccountType,
  DriverCategory,
  DriversData,
} from "@/lib/queries/net-worth-drilldown";
import { pct } from "@/lib/queries/_percent";

/**
 * One row of getNetWorthDrivers' query: a single account outside the
 * Restricted Asset category, with its cumulative balance on the period's start
 * and end dates. `start_balance` and `end_balance` are pg `numeric`, so they
 * arrive as strings.
 *
 * The same eight columns as AssetPerformanceRow today, declared separately on
 * purpose: the two queries answer different questions and are free to drift.
 * A `type`, not an `interface`, for the cast reason given on that one.
 */
export type NetWorthDriverRow = {
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
 * Rolls per-account balance changes up into the category → type → account
 * tree the Net Worth Drivers table renders (Issue #143).
 *
 * This is the table's whole hierarchy build. It runs on the server, once per
 * request; NetWorthDriversTable only maps the finished tree to rows, so there
 * is nothing on the client to memoize. Kept apart from net-worth-drilldown.ts,
 * and free of any database import, so the unit project can reach its edge
 * cases directly.
 *
 * Shares are signed contributions: an account that moved against its parent
 * gets a negative % of Parent, and the shares of one parent still sum to 100.
 * When a parent's change is zero every share of it is 0. Account types and
 * accounts are sorted by |change|, largest first; categories keep the query's
 * order (by category id).
 */
export function buildNetWorthDrivers(
  rows: readonly NetWorthDriverRow[]
): DriversData {
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
