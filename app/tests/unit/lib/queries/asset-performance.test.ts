import { describe, it, expect } from "vitest";
import {
  buildAssetPerformance,
  type AssetPerformanceRow,
} from "@/lib/queries/asset-performance";

// One asset account's start/end balances, as getAssetPerformance's query
// returns them: numeric columns arrive from pg as strings.
const row = (overrides: Partial<AssetPerformanceRow>): AssetPerformanceRow => ({
  category_id: 1,
  category_name: "Current Asset",
  account_type_id: 2,
  account_type_name: "Checking",
  account_id: 7,
  account_name: "Everyday",
  start_balance: "0.00",
  end_balance: "0.00",
  ...overrides,
});

// The only account in the tree, wherever it sits.
const onlyAccount = (rows: AssetPerformanceRow[]) =>
  buildAssetPerformance(rows).categories[0].accountTypes[0].accounts[0];

describe("buildAssetPerformance", () => {
  describe("empty input", () => {
    it("returns zero totals, an undefined total % change and no categories", () => {
      expect(buildAssetPerformance([])).toEqual({
        totalCurrentValue: 0,
        totalStartValue: 0,
        totalChange: 0,
        totalPercentChange: null,
        categories: [],
      });
    });
  });

  describe("a single account", () => {
    it("builds the full category → type → account tree", () => {
      const result = buildAssetPerformance([
        row({ start_balance: "1000.00", end_balance: "1100.00" }),
      ]);

      expect(result).toEqual({
        totalCurrentValue: 1100,
        totalStartValue: 1000,
        totalChange: 100,
        totalPercentChange: 10,
        categories: [
          {
            categoryId: 1,
            categoryName: "Current Asset",
            currentValue: 1100,
            startValue: 1000,
            change: 100,
            percentChange: 10,
            percentOfTotal: 100,
            accountTypes: [
              {
                accountTypeId: 2,
                accountTypeName: "Checking",
                currentValue: 1100,
                startValue: 1000,
                change: 100,
                percentChange: 10,
                percentOfParent: 100,
                percentOfTotal: 100,
                accounts: [
                  {
                    accountId: 7,
                    accountName: "Everyday",
                    currentValue: 1100,
                    startValue: 1000,
                    change: 100,
                    percentChange: 10,
                    percentOfParent: 100,
                    percentOfTotal: 100,
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    it("reports no change when start and end are the same date", () => {
      // dateFrom === dateTo: both balanceAtDate columns read the same row.
      const account = onlyAccount([
        row({ start_balance: "250.00", end_balance: "250.00" }),
      ]);
      expect(account.change).toBe(0);
      expect(account.percentChange).toBe(0);
    });
  });

  describe("a single balance point", () => {
    it("reads an account with no start-date row as 0 → end", () => {
      // An account opened mid-range has no row on dateFrom, so the query's
      // COALESCE gives it a start balance of 0.
      const result = buildAssetPerformance([
        row({ start_balance: "0", end_balance: "500.00" }),
      ]);
      const account = result.categories[0].accountTypes[0].accounts[0];

      expect(account.startValue).toBe(0);
      expect(account.change).toBe(500);
      // A rate of change against a zero start is undefined: null, shown as
      // "—". Until Issue #143 this read 0.00%.
      expect(account.percentChange).toBeNull();
      expect(result.categories[0].percentChange).toBeNull();
      expect(result.categories[0].accountTypes[0].percentChange).toBeNull();
      expect(result.totalPercentChange).toBeNull();
    });

    it("leaves a zero-start account's siblings with a real % change", () => {
      const result = buildAssetPerformance([
        row({ account_id: 1, account_name: "Old", start_balance: "1000.00", end_balance: "1100.00" }),
        row({ account_id: 2, account_name: "New", start_balance: "0", end_balance: "500.00" }),
      ]);
      const type = result.categories[0].accountTypes[0];

      expect(type.accounts.map((a) => [a.accountName, a.percentChange])).toEqual([
        ["Old", 10],
        ["New", null],
      ]);
      // The parent has a non-zero start, so its rate is defined: +600 on 1000.
      expect(type.percentChange).toBe(60);
    });

    it("reads an account with no end-date row as start → 0", () => {
      const result = buildAssetPerformance([
        row({ start_balance: "500.00", end_balance: "0" }),
      ]);
      const account = result.categories[0].accountTypes[0].accounts[0];

      expect(account.change).toBe(-500);
      expect(account.percentChange).toBe(-100);
      // Nothing is left at the end, so every share of the total is a share
      // of zero.
      expect(account.percentOfTotal).toBe(0);
      expect(result.categories[0].percentOfTotal).toBe(0);
    });
  });

  describe("a negative start balance", () => {
    it("signs an overdrawn account's recovery as a gain", () => {
      // -$100 → +$50 is a gain of $150. Dividing by |start| keeps the sign of
      // the change; until Issue #143 the signed start flipped it to -150%,
      // which the table drew red with a down arrow.
      const result = buildAssetPerformance([
        row({ start_balance: "-100.00", end_balance: "50.00" }),
      ]);
      const account = result.categories[0].accountTypes[0].accounts[0];

      expect(account.change).toBe(150);
      expect(account.percentChange).toBe(150);
      expect(result.categories[0].percentChange).toBe(150);
      expect(result.categories[0].accountTypes[0].percentChange).toBe(150);
      expect(result.totalPercentChange).toBe(150);
    });

    it("signs sinking further below zero as a loss", () => {
      const account = onlyAccount([
        row({ start_balance: "-100.00", end_balance: "-200.00" }),
      ]);
      expect(account.change).toBe(-100);
      expect(account.percentChange).toBe(-100);
    });

    it("signs a fall from positive to negative as a loss", () => {
      const account = onlyAccount([
        row({ start_balance: "100.00", end_balance: "-50.00" }),
      ]);
      expect(account.change).toBe(-150);
      expect(account.percentChange).toBe(-150);
    });
  });

  describe("aggregation", () => {
    // 2 categories × 2 types × 2 accounts, in the query's ORDER BY order.
    const rows: AssetPerformanceRow[] = [
      row({ category_id: 1, category_name: "Current Asset", account_type_id: 1, account_type_name: "Cash", account_id: 10, account_name: "Wallet", start_balance: "100.00", end_balance: "200.00" }),
      row({ category_id: 1, category_name: "Current Asset", account_type_id: 1, account_type_name: "Cash", account_id: 11, account_name: "Jar", start_balance: "50.00", end_balance: "50.00" }),
      row({ category_id: 1, category_name: "Current Asset", account_type_id: 2, account_type_name: "Checking", account_id: 20, account_name: "Everyday", start_balance: "1000.00", end_balance: "1500.00" }),
      row({ category_id: 1, category_name: "Current Asset", account_type_id: 2, account_type_name: "Checking", account_id: 21, account_name: "Bills", start_balance: "400.00", end_balance: "300.00" }),
      row({ category_id: 4, category_name: "Investment", account_type_id: 12, account_type_name: "Stock", account_id: 30, account_name: "Brokerage", start_balance: "10000.00", end_balance: "12000.00" }),
      row({ category_id: 4, category_name: "Investment", account_type_id: 12, account_type_name: "Stock", account_id: 31, account_name: "IRA", start_balance: "5000.00", end_balance: "4000.00" }),
      row({ category_id: 4, category_name: "Investment", account_type_id: 13, account_type_name: "Bond", account_id: 40, account_name: "Treasury", start_balance: "2000.00", end_balance: "2100.00" }),
      row({ category_id: 4, category_name: "Investment", account_type_id: 13, account_type_name: "Bond", account_id: 41, account_name: "Muni", start_balance: "1000.00", end_balance: "1000.00" }),
    ];
    const result = buildAssetPerformance(rows);

    it("totals every account", () => {
      expect(result.totalCurrentValue).toBe(21150);
      expect(result.totalStartValue).toBe(19550);
      expect(result.totalChange).toBe(1600);
      expect(result.totalPercentChange).toBe(8.18);
    });

    it("makes each parent the sum of its children, at both levels", () => {
      for (const cat of result.categories) {
        const types = cat.accountTypes;
        expect(types.reduce((s, t) => s + t.currentValue, 0)).toBeCloseTo(cat.currentValue, 2);
        expect(types.reduce((s, t) => s + t.startValue, 0)).toBeCloseTo(cat.startValue, 2);
        expect(cat.change).toBeCloseTo(cat.currentValue - cat.startValue, 2);

        for (const type of types) {
          const accts = type.accounts;
          expect(accts.reduce((s, a) => s + a.currentValue, 0)).toBeCloseTo(type.currentValue, 2);
          expect(accts.reduce((s, a) => s + a.startValue, 0)).toBeCloseTo(type.startValue, 2);
        }
      }
    });

    it("computes shares of parent and of total", () => {
      const investment = result.categories[0];
      const stock = investment.accountTypes[0];
      const brokerage = stock.accounts[0];

      expect(investment.percentOfTotal).toBe(90.31);
      expect(stock.percentOfParent).toBe(83.77);
      expect(stock.percentOfTotal).toBe(75.65);
      expect(brokerage.percentOfParent).toBe(75);
      expect(brokerage.percentOfTotal).toBe(56.74);

      // Shares of one parent add up to ~100, rounding aside.
      const catShares = result.categories.reduce((s, c) => s + c.percentOfTotal, 0);
      expect(catShares).toBeCloseTo(100, 1);
      const typeShares = investment.accountTypes.reduce((s, t) => s + t.percentOfParent, 0);
      expect(typeShares).toBeCloseTo(100, 1);
    });

    it("computes each level's own percent change", () => {
      const stock = result.categories[0].accountTypes[0];
      expect(stock.percentChange).toBe(6.67);
      expect(stock.accounts.find((a) => a.accountName === "IRA")?.percentChange).toBe(-20);
    });

    it("sorts every level by current value, largest first", () => {
      expect(result.categories.map((c) => c.categoryName)).toEqual(["Investment", "Current Asset"]);
      expect(result.categories[0].accountTypes.map((t) => t.accountTypeName)).toEqual(["Stock", "Bond"]);
      expect(result.categories[1].accountTypes.map((t) => t.accountTypeName)).toEqual(["Checking", "Cash"]);
      expect(result.categories[1].accountTypes[0].accounts.map((a) => a.accountName)).toEqual(["Everyday", "Bills"]);
    });
  });

  describe("grouping", () => {
    it("groups rows by id regardless of the order they arrive in", () => {
      const result = buildAssetPerformance([
        row({ account_id: 1, account_name: "A", end_balance: "300.00" }),
        row({ category_id: 4, category_name: "Investment", account_type_id: 12, account_type_name: "Stock", account_id: 2, account_name: "B", end_balance: "100.00" }),
        row({ account_id: 3, account_name: "C", end_balance: "200.00" }),
      ]);

      expect(result.categories).toHaveLength(2);
      const current = result.categories.find((c) => c.categoryId === 1);
      expect(current?.accountTypes).toHaveLength(1);
      expect(current?.accountTypes[0].accounts.map((a) => a.accountName)).toEqual(["A", "C"]);
      expect(current?.currentValue).toBe(500);
    });
  });

  describe("shares with zero or negative parts", () => {
    it("reports a 0 share of a type whose accounts net to zero", () => {
      const result = buildAssetPerformance([
        row({ account_id: 1, account_name: "Up", end_balance: "100.00" }),
        row({ account_id: 2, account_name: "Down", end_balance: "-100.00" }),
      ]);
      const type = result.categories[0].accountTypes[0];

      expect(type.currentValue).toBe(0);
      expect(type.accounts.map((a) => a.percentOfParent)).toEqual([0, 0]);
    });

    it("gives a negative account a negative share, and the shares still sum to 100", () => {
      const type = buildAssetPerformance([
        row({ account_id: 1, account_name: "Savings", end_balance: "1000.00" }),
        row({ account_id: 2, account_name: "Overdrawn", end_balance: "-100.00" }),
      ]).categories[0].accountTypes[0];

      expect(type.accounts.map((a) => a.percentOfParent)).toEqual([111.11, -11.11]);
      expect(type.accounts.reduce((s, a) => s + a.percentOfParent, 0)).toBeCloseTo(100, 2);
    });
  });

  describe("ordering", () => {
    it("sorts by current value, not by change", () => {
      const accounts = buildAssetPerformance([
        row({ account_id: 1, account_name: "Mover", start_balance: "100.00", end_balance: "900.00" }),
        row({ account_id: 2, account_name: "Steady", start_balance: "1000.00", end_balance: "1000.00" }),
      ]).categories[0].accountTypes[0].accounts;

      expect(accounts.map((a) => a.accountName)).toEqual(["Steady", "Mover"]);
    });

    it("keeps row order for equal values", () => {
      const accounts = buildAssetPerformance([
        row({ account_id: 2, account_name: "Second id", end_balance: "500.00" }),
        row({ account_id: 1, account_name: "First id", end_balance: "500.00" }),
      ]).categories[0].accountTypes[0].accounts;

      expect(accounts.map((a) => a.accountId)).toEqual([2, 1]);
    });

    it("puts a negative balance last", () => {
      const accounts = buildAssetPerformance([
        row({ account_id: 1, account_name: "Overdrawn", end_balance: "-50.00" }),
        row({ account_id: 2, account_name: "Empty", end_balance: "0" }),
        row({ account_id: 3, account_name: "Savings", end_balance: "10.00" }),
      ]).categories[0].accountTypes[0].accounts;

      expect(accounts.map((a) => a.accountName)).toEqual(["Savings", "Empty", "Overdrawn"]);
    });
  });

  describe("parsing", () => {
    it("treats an unparseable balance as 0", () => {
      const account = onlyAccount([row({ start_balance: "", end_balance: "abc" })]);
      expect(account.startValue).toBe(0);
      expect(account.currentValue).toBe(0);
      expect(account.change).toBe(0);
    });

    it("keeps the cents of a numeric string", () => {
      const account = onlyAccount([row({ start_balance: "1234.56", end_balance: "1300.01" })]);
      expect(account.startValue).toBe(1234.56);
      expect(account.currentValue).toBe(1300.01);
      expect(account.change).toBeCloseTo(65.45, 2);
    });
  });
});
