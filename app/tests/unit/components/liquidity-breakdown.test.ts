import { describe, it, expect } from "vitest";
import { buildLiquidityTiles } from "@/components/dashboard/liquidity-breakdown";
import type { LiquidityData } from "@/lib/queries/assets-drilldown";

describe("buildLiquidityTiles", () => {
  it("returns the four standard tiles when no unclassified data is present", () => {
    const data: LiquidityData = {
      total: 100_000,
      asOf: "2026-04-19",
      classes: [
        { liquidityClass: "liquid", value: 25_000, percent: 25 },
        { liquidityClass: "semi_liquid", value: 25_000, percent: 25 },
        { liquidityClass: "illiquid", value: 40_000, percent: 40 },
        { liquidityClass: "restricted", value: 10_000, percent: 10 },
      ],
    };

    const tiles = buildLiquidityTiles(data);

    expect(tiles.map((t) => t.liquidityClass)).toEqual([
      "liquid",
      "semi_liquid",
      "illiquid",
      "restricted",
    ]);
    expect(tiles.every((t) => t.hasData)).toBe(true);
  });

  it("includes the unclassified tile when present in the data", () => {
    const data: LiquidityData = {
      total: 1_100,
      asOf: "2026-04-19",
      classes: [
        { liquidityClass: "liquid", value: 1_000, percent: 90.91 },
        { liquidityClass: "unclassified", value: 100, percent: 9.09 },
      ],
    };

    const tiles = buildLiquidityTiles(data);
    const classes = tiles.map((t) => t.liquidityClass);
    expect(classes).toContain("unclassified");
    expect(classes).toHaveLength(5);
  });

  it("renders 0% / $0 for missing standard classes", () => {
    const data: LiquidityData = {
      total: 500,
      asOf: "2026-04-19",
      classes: [{ liquidityClass: "liquid", value: 500, percent: 100 }],
    };

    const tiles = buildLiquidityTiles(data);
    const missing = tiles.filter(
      (t) => t.liquidityClass !== "liquid" && !t.hasData
    );
    for (const t of missing) {
      expect(t.value).toBe(0);
      expect(t.percent).toBe(0);
    }
  });

  it("percents sum to approximately 100 (within rounding slack)", () => {
    const data: LiquidityData = {
      total: 100_000,
      asOf: "2026-04-19",
      classes: [
        { liquidityClass: "liquid", value: 33_333, percent: 33.33 },
        { liquidityClass: "semi_liquid", value: 33_333, percent: 33.33 },
        { liquidityClass: "illiquid", value: 33_334, percent: 33.34 },
      ],
    };

    const tiles = buildLiquidityTiles(data);
    const pctSum = tiles.reduce((s, t) => s + t.percent, 0);
    expect(pctSum).toBeGreaterThan(99.5);
    expect(pctSum).toBeLessThan(100.5);
  });

  it("handles an empty data set without throwing", () => {
    const data: LiquidityData = {
      total: 0,
      asOf: "",
      classes: [],
    };

    const tiles = buildLiquidityTiles(data);
    expect(tiles).toHaveLength(4); // unclassified excluded when absent
    for (const t of tiles) {
      expect(t.value).toBe(0);
      expect(t.percent).toBe(0);
      expect(t.hasData).toBe(false);
    }
  });
});
