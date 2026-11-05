import { describe, it, expect } from "vitest";
import {
  buildNetWorthDrivers,
  type NetWorthDriverRow,
} from "@/lib/queries/net-worth-drivers";

// One account's start/end balances, as getNetWorthDrivers' query returns
// them: numeric columns arrive from pg as strings. Liability balances are
// stored negative, so paying debt down is a positive change.
const row = (overrides: Partial<NetWorthDriverRow>): NetWorthDriverRow => ({
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

const card = (
  accountId: number,
  accountName: string,
  start: string,
  end: string
): NetWorthDriverRow =>
  row({
    category_id: 5,
    category_name: "Current Liability",
    account_type_id: 15,
    account_type_name: "Credit Card",
    account_id: accountId,
    account_name: accountName,
    start_balance: start,
    end_balance: end,
  });

describe("buildNetWorthDrivers", () => {
  it("returns a zero total and no categories for no rows", () => {
    expect(buildNetWorthDrivers([])).toEqual({ totalChange: 0, categories: [] });
  });

  it("builds the full category → type → account tree for one account", () => {
    expect(
      buildNetWorthDrivers([row({ start_balance: "1000.00", end_balance: "1250.00" })])
    ).toEqual({
      totalChange: 250,
      categories: [
        {
          categoryId: 1,
          categoryName: "Current Asset",
          change: 250,
          percentOfTotal: 100,
          accountTypes: [
            {
              accountTypeId: 2,
              accountTypeName: "Checking",
              change: 250,
              percentOfParent: 100,
              percentOfTotal: 100,
              accounts: [
                {
                  accountId: 7,
                  accountName: "Everyday",
                  change: 250,
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

  describe("a single balance point", () => {
    it("counts an account with no start-date row as its whole end balance", () => {
      // Opened mid-range: the query's COALESCE gives it a start of 0.
      const result = buildNetWorthDrivers([row({ start_balance: "0", end_balance: "400.00" })]);
      expect(result.totalChange).toBe(400);
    });

    it("counts an account with no end-date row as losing its whole start balance", () => {
      const result = buildNetWorthDrivers([row({ start_balance: "400.00", end_balance: "0" })]);
      expect(result.totalChange).toBe(-400);
    });

    it("reports no change when start and end are the same date", () => {
      const result = buildNetWorthDrivers([row({ start_balance: "900.00", end_balance: "900.00" })]);
      expect(result.totalChange).toBe(0);
      expect(result.categories[0].percentOfTotal).toBe(0);
    });
  });

  describe("signed shares", () => {
    it("nets assets and liabilities into one total", () => {
      const result = buildNetWorthDrivers([
        row({ start_balance: "1000.00", end_balance: "6000.00" }),
        card(20, "Visa", "-500.00", "-1500.00"),
      ]);

      expect(result.totalChange).toBe(4000);
      expect(result.categories.map((c) => c.percentOfTotal)).toEqual([125, -25]);
    });

    it("gives an account that moved against its parent a negative share", () => {
      // The category took on $1,000 of debt overall, but Visa was paid down
      // $200 inside it — Visa *offset* the parent's change.
      const type = buildNetWorthDrivers([
        card(20, "Visa", "-1000.00", "-800.00"),
        card(21, "Amex", "-1000.00", "-2200.00"),
      ]).categories[0].accountTypes[0];

      expect(type.change).toBe(-1000);
      const share = (name: string) =>
        type.accounts.find((a) => a.accountName === name)?.percentOfParent;
      expect(share("Visa")).toBe(-20);
      expect(share("Amex")).toBe(120);
      expect(type.accounts.reduce((s, a) => s + a.percentOfParent, 0)).toBeCloseTo(100, 2);
    });

    it("reports every share of the total as 0 when the changes offset exactly", () => {
      const result = buildNetWorthDrivers([
        row({ start_balance: "1000.00", end_balance: "1500.00" }),
        card(20, "Visa", "-500.00", "-1000.00"),
      ]);

      expect(result.totalChange).toBe(0);
      expect(result.categories.map((c) => c.percentOfTotal)).toEqual([0, 0]);
      const accounts = result.categories.flatMap((c) =>
        c.accountTypes.flatMap((t) => t.accounts)
      );
      expect(accounts.map((a) => a.percentOfTotal)).toEqual([0, 0]);
    });

    it("reports every share of a type as 0 when its accounts net to zero", () => {
      const result = buildNetWorthDrivers([
        row({ account_id: 1, account_name: "Up", start_balance: "0", end_balance: "100.00" }),
        row({ account_id: 2, account_name: "Down", start_balance: "100.00", end_balance: "0" }),
      ]);
      const type = result.categories[0].accountTypes[0];

      expect(type.change).toBe(0);
      expect(type.accounts.map((a) => a.percentOfParent)).toEqual([0, 0]);
    });

    it("computes a type's share of its category", () => {
      const result = buildNetWorthDrivers([
        row({ account_type_id: 1, account_type_name: "Cash", account_id: 1, start_balance: "0", end_balance: "300.00" }),
        row({ account_type_id: 2, account_type_name: "Checking", account_id: 2, start_balance: "0", end_balance: "100.00" }),
      ]);
      expect(result.categories[0].accountTypes.map((t) => t.percentOfParent)).toEqual([75, 25]);
    });
  });

  describe("ordering", () => {
    it("keeps categories in row order rather than sorting them", () => {
      // The query orders by category id; a much larger change in a later
      // category does not move it up.
      const result = buildNetWorthDrivers([
        row({ start_balance: "0", end_balance: "10.00" }),
        card(20, "Visa", "0", "-5000.00"),
      ]);
      expect(result.categories.map((c) => c.categoryId)).toEqual([1, 5]);
    });

    it("sorts account types and accounts by the size of their change, either sign", () => {
      const result = buildNetWorthDrivers([
        row({ account_type_id: 1, account_type_name: "Cash", account_id: 1, account_name: "Small gain", start_balance: "0", end_balance: "50.00" }),
        row({ account_type_id: 1, account_type_name: "Cash", account_id: 2, account_name: "Big loss", start_balance: "300.00", end_balance: "0" }),
        row({ account_type_id: 2, account_type_name: "Checking", account_id: 3, account_name: "Huge gain", start_balance: "0", end_balance: "1000.00" }),
      ]);
      const [first, second] = result.categories[0].accountTypes;

      expect([first.accountTypeName, second.accountTypeName]).toEqual(["Checking", "Cash"]);
      expect(second.accounts.map((a) => a.accountName)).toEqual(["Big loss", "Small gain"]);
    });

    it("keeps row order for changes of equal size", () => {
      const accounts = buildNetWorthDrivers([
        row({ account_id: 2, start_balance: "0", end_balance: "100.00" }),
        row({ account_id: 1, start_balance: "100.00", end_balance: "0" }),
      ]).categories[0].accountTypes[0].accounts;

      expect(accounts.map((a) => a.accountId)).toEqual([2, 1]);
    });
  });

  it("groups rows by id regardless of the order they arrive in", () => {
    const result = buildNetWorthDrivers([
      row({ account_id: 1, start_balance: "0", end_balance: "100.00" }),
      card(20, "Visa", "-100.00", "-50.00"),
      row({ account_id: 3, start_balance: "0", end_balance: "200.00" }),
    ]);

    expect(result.categories).toHaveLength(2);
    const current = result.categories[0];
    expect(current.accountTypes).toHaveLength(1);
    expect(current.accountTypes[0].accounts.map((a) => a.accountId)).toEqual([3, 1]);
    expect(current.change).toBe(300);
  });

  it("treats an unparseable balance as 0", () => {
    const result = buildNetWorthDrivers([row({ start_balance: "", end_balance: "abc" })]);
    expect(result.totalChange).toBe(0);
  });
});
