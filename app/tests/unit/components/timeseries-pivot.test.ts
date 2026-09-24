import { describe, it, expect } from "vitest";
import {
  pivotByCategory,
  pivotDecomposition,
  FALLBACK_SERIES_COLOR,
  type CategoryPoint,
  type DecompositionPointLike,
} from "@/components/charts/timeseries-pivot";

const COLORS = { 1: "#aaa", 2: "#bbb" };

const cat = (
  date: string,
  categoryId: number,
  categoryName: string,
  cumulativeBalance: number
): CategoryPoint => ({ date, categoryId, categoryName, cumulativeBalance });

describe("pivotByCategory", () => {
  it("emits one series per category and one row per date", () => {
    const { rows, series } = pivotByCategory(
      [
        cat("2026-01-01", 1, "Current Asset", 100),
        cat("2026-01-01", 2, "Investment", 200),
        cat("2026-01-02", 1, "Current Asset", 150),
        cat("2026-01-02", 2, "Investment", 250),
      ],
      COLORS
    );

    expect(series.map((s) => s.key)).toEqual(["cat_1", "cat_2"]);
    expect(rows).toEqual([
      { date: "2026-01-01", cat_1: 100, cat_2: 200 },
      { date: "2026-01-02", cat_1: 150, cat_2: 250 },
    ]);
  });

  it("sorts series by category id, not by first appearance", () => {
    // Stacking order has to survive a range that happens to return the
    // higher-numbered category first.
    const { series } = pivotByCategory(
      [cat("2026-01-01", 2, "Investment", 1), cat("2026-01-01", 1, "Current Asset", 1)],
      COLORS
    );
    expect(series.map((s) => s.categoryId)).toEqual([1, 2]);
  });

  it("sorts rows chronologically even when the input is not", () => {
    const { rows } = pivotByCategory(
      [cat("2026-03-01", 1, "A", 1), cat("2026-01-01", 1, "A", 1), cat("2026-02-01", 1, "A", 1)],
      COLORS
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("fills an absent series with 0 so the line stays continuous", () => {
    // Category 2 has no point on Jan 1. It must still be present as 0, or
    // recharts draws a gap instead of a flat segment.
    const { rows } = pivotByCategory(
      [cat("2026-01-01", 1, "A", 100), cat("2026-01-02", 1, "A", 100), cat("2026-01-02", 2, "B", 50)],
      COLORS
    );
    expect(rows[0]).toEqual({ date: "2026-01-01", cat_1: 100, cat_2: 0 });
  });

  it("sums multiple points that land in the same cell", () => {
    const { rows } = pivotByCategory(
      [cat("2026-01-01", 1, "A", 100), cat("2026-01-01", 1, "A", 50)],
      COLORS
    );
    expect(rows[0].cat_1).toBe(150);
  });

  it("falls back to grey for a category with no mapped colour", () => {
    const { series } = pivotByCategory([cat("2026-01-01", 99, "Unmapped", 1)], COLORS);
    expect(series[0].color).toBe(FALLBACK_SERIES_COLOR);
  });

  it("returns empty rows and series for no points", () => {
    expect(pivotByCategory([], COLORS)).toEqual({ rows: [], series: [] });
  });
});

const dp = (
  date: string,
  over: Partial<DecompositionPointLike> = {}
): DecompositionPointLike => ({
  date,
  categoryId: 1,
  categoryName: "Current Asset",
  accountTypeId: 10,
  accountTypeName: "Checking",
  accountId: 100,
  accountName: "Everyday",
  cumulativeBalance: 1,
  ...over,
});

const PALETTE = ["#1", "#2", "#3"];

describe("pivotDecomposition", () => {
  it.each([
    ["category", "cat_1", "Current Asset"],
    ["account-type", "type_10", "Checking"],
    ["account", "acct_100", "Everyday"],
  ] as const)("keys and labels series by %s", (mode, key, label) => {
    const { series } = pivotDecomposition([dp("2026-01-01")], mode, PALETTE);
    expect(series).toEqual([{ key, label, color: "#1" }]);
  });

  it("cycles the palette when there are more series than colours", () => {
    const { series } = pivotDecomposition(
      [
        dp("2026-01-01", { accountId: 1, accountName: "A" }),
        dp("2026-01-01", { accountId: 2, accountName: "B" }),
        dp("2026-01-01", { accountId: 3, accountName: "C" }),
        dp("2026-01-01", { accountId: 4, accountName: "D" }),
      ],
      "account",
      PALETTE
    );
    expect(series.map((s) => s.color)).toEqual(["#1", "#2", "#3", "#1"]);
  });

  it("keeps query order for series rather than sorting by id", () => {
    // Unlike pivotByCategory, colours here follow insertion order.
    const { series } = pivotDecomposition(
      [
        dp("2026-01-01", { accountId: 9, accountName: "Zed" }),
        dp("2026-01-01", { accountId: 2, accountName: "Alpha" }),
      ],
      "account",
      PALETTE
    );
    expect(series.map((s) => s.label)).toEqual(["Zed", "Alpha"]);
  });

  it("collapses points that share a key at the chosen level", () => {
    // Two accounts under one type: at account-type level they sum.
    const { rows } = pivotDecomposition(
      [
        dp("2026-01-01", { accountId: 1, cumulativeBalance: 100 }),
        dp("2026-01-01", { accountId: 2, cumulativeBalance: 50 }),
      ],
      "account-type",
      PALETTE
    );
    expect(rows).toEqual([{ date: "2026-01-01", type_10: 150 }]);
  });

  it("returns empty rows and series for no points", () => {
    expect(pivotDecomposition([], "category", PALETTE)).toEqual({ rows: [], series: [] });
  });
});
