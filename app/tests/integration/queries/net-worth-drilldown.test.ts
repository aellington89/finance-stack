import { describe, it, expect } from "vitest";
import {
  getNetWorthWaterfall,
  getNetWorthDrivers,
  getNetWorthTrendDecomposition,
} from "@/lib/queries/net-worth-drilldown";

const today = new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
  .toISOString()
  .slice(0, 10);

// The Finances_Test database is seeded with 8 accounts spanning 12 months.
// These tests validate the shape and correctness of the drill-down queries
// against that seed data.

describe("getNetWorthWaterfall", () => {
  it("returns start/end net worth and per-category changes", async () => {
    const result = await getNetWorthWaterfall(thirtyDaysAgo, today);

    expect(result).toHaveProperty("startNetWorth");
    expect(result).toHaveProperty("endNetWorth");
    expect(result.categories).toBeInstanceOf(Array);
    expect(result.categories.length).toBeGreaterThan(0);

    for (const cat of result.categories) {
      expect(cat).toHaveProperty("categoryId");
      expect(cat).toHaveProperty("categoryName");
      expect(cat).toHaveProperty("startBalance");
      expect(cat).toHaveProperty("endBalance");
      expect(cat).toHaveProperty("change");
      expect(cat.change).toBeCloseTo(cat.endBalance - cat.startBalance, 2);
    }
  });

  it("per-category changes sum to total net worth change", async () => {
    const result = await getNetWorthWaterfall(thirtyDaysAgo, today);
    const totalChange = result.endNetWorth - result.startNetWorth;
    const sumOfChanges = result.categories.reduce(
      (sum, c) => sum + c.change,
      0
    );

    expect(sumOfChanges).toBeCloseTo(totalChange, 2);
  });

  it("excludes Restricted Asset (category_id=2)", async () => {
    const result = await getNetWorthWaterfall(thirtyDaysAgo, today);
    const restrictedAsset = result.categories.find(
      (c) => c.categoryId === 2
    );

    expect(restrictedAsset).toBeUndefined();
  });

  it("start and end net worth are derived from category balances", async () => {
    const result = await getNetWorthWaterfall(thirtyDaysAgo, today);

    const startFromCategories = result.categories.reduce(
      (sum, c) => sum + c.startBalance,
      0
    );
    const endFromCategories = result.categories.reduce(
      (sum, c) => sum + c.endBalance,
      0
    );

    expect(result.startNetWorth).toBeCloseTo(startFromCategories, 2);
    expect(result.endNetWorth).toBeCloseTo(endFromCategories, 2);
  });
});

describe("getNetWorthDrivers", () => {
  it("returns total change and nested category/type/account rows", async () => {
    const result = await getNetWorthDrivers(thirtyDaysAgo, today);

    expect(result).toHaveProperty("totalChange");
    expect(result.categories).toBeInstanceOf(Array);
    expect(result.categories.length).toBeGreaterThan(0);

    for (const cat of result.categories) {
      expect(cat).toHaveProperty("categoryId");
      expect(cat).toHaveProperty("categoryName");
      expect(cat).toHaveProperty("change");
      expect(cat).toHaveProperty("percentOfTotal");
      expect(cat.accountTypes).toBeInstanceOf(Array);
      expect(cat.accountTypes.length).toBeGreaterThan(0);

      for (const t of cat.accountTypes) {
        expect(t).toHaveProperty("accountTypeId");
        expect(t).toHaveProperty("accountTypeName");
        expect(t).toHaveProperty("percentOfParent");
        expect(t).toHaveProperty("percentOfTotal");
        expect(t.accounts).toBeInstanceOf(Array);
        expect(t.accounts.length).toBeGreaterThan(0);

        for (const a of t.accounts) {
          expect(a).toHaveProperty("accountId");
          expect(a).toHaveProperty("accountName");
          expect(a).toHaveProperty("change");
          expect(a).toHaveProperty("percentOfParent");
          expect(a).toHaveProperty("percentOfTotal");
        }
      }
    }
  });

  it("category percent-of-total sums to approximately 100 when total change is nonzero", async () => {
    const result = await getNetWorthDrivers(thirtyDaysAgo, today);

    if (result.totalChange !== 0) {
      const sumPercent = result.categories.reduce(
        (sum, c) => sum + c.percentOfTotal,
        0
      );
      expect(sumPercent).toBeCloseTo(100, 0);
    }
  });

  it("child changes sum to parent change at each level", async () => {
    const result = await getNetWorthDrivers(thirtyDaysAgo, today);

    for (const cat of result.categories) {
      const typesSum = cat.accountTypes.reduce((s, t) => s + t.change, 0);
      expect(typesSum).toBeCloseTo(cat.change, 2);

      for (const t of cat.accountTypes) {
        const accSum = t.accounts.reduce((s, a) => s + a.change, 0);
        expect(accSum).toBeCloseTo(t.change, 2);
      }
    }

    const catSum = result.categories.reduce((s, c) => s + c.change, 0);
    expect(catSum).toBeCloseTo(result.totalChange, 2);
  });
});

describe("getNetWorthTrendDecomposition", () => {
  it("returns data points with expected shape", async () => {
    const result = await getNetWorthTrendDecomposition(
      thirtyDaysAgo,
      today
    );

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);

    const first = result[0];
    expect(first).toHaveProperty("date");
    expect(first).toHaveProperty("categoryId");
    expect(first).toHaveProperty("categoryName");
    expect(first).toHaveProperty("accountTypeId");
    expect(first).toHaveProperty("accountTypeName");
    expect(first).toHaveProperty("accountId");
    expect(first).toHaveProperty("accountName");
    expect(first).toHaveProperty("cumulativeBalance");
  });

  it("excludes Restricted Asset (category_id=2)", async () => {
    const result = await getNetWorthTrendDecomposition(
      thirtyDaysAgo,
      today
    );
    const restricted = result.find((p) => p.categoryId === 2);

    expect(restricted).toBeUndefined();
  });

  it("respects date range filtering", async () => {
    const result = await getNetWorthTrendDecomposition(
      thirtyDaysAgo,
      today
    );

    for (const point of result) {
      expect(point.date >= thirtyDaysAgo).toBe(true);
      expect(point.date <= today).toBe(true);
    }
  });

  it("returns data sorted by date", async () => {
    const result = await getNetWorthTrendDecomposition(
      thirtyDaysAgo,
      today
    );

    for (let i = 1; i < result.length; i++) {
      expect(result[i].date >= result[i - 1].date).toBe(true);
    }
  });
});
