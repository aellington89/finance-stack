import { describe, it, expect } from "vitest";
import { buildWaterfallBars } from "@/components/charts/waterfall-chart";
import type { WaterfallData } from "@/lib/queries/net-worth-drilldown";

describe("buildWaterfallBars", () => {
  const sampleData: WaterfallData = {
    startNetWorth: 100_000,
    endNetWorth: 115_000,
    categories: [
      {
        categoryId: 1,
        categoryName: "Current Asset",
        startBalance: 50_000,
        endBalance: 60_000,
        change: 10_000,
      },
      {
        categoryId: 3,
        categoryName: "Fixed Asset",
        startBalance: 200_000,
        endBalance: 200_000,
        change: 0,
      },
      {
        categoryId: 5,
        categoryName: "Current Liability",
        startBalance: -150_000,
        endBalance: -145_000,
        change: 5_000,
      },
    ],
  };

  it("starts with a 'Start' bar and ends with an 'End' bar", () => {
    const bars = buildWaterfallBars(sampleData);

    expect(bars[0].name).toBe("Start");
    expect(bars[0].type).toBe("start");
    expect(bars[0].displayValue).toBe(100_000);

    expect(bars[bars.length - 1].name).toBe("End");
    expect(bars[bars.length - 1].type).toBe("end");
    expect(bars[bars.length - 1].displayValue).toBe(115_000);
  });

  it("skips categories with zero change", () => {
    const bars = buildWaterfallBars(sampleData);
    const fixedAssetBar = bars.find((b) => b.name === "Fixed Asset");

    expect(fixedAssetBar).toBeUndefined();
  });

  it("includes categories with nonzero change", () => {
    const bars = buildWaterfallBars(sampleData);
    const currentAsset = bars.find((b) => b.name === "Current Asset");
    const currentLiability = bars.find((b) => b.name === "Current Liability");

    expect(currentAsset).toBeDefined();
    expect(currentAsset!.displayValue).toBe(10_000);
    expect(currentAsset!.type).toBe("positive");

    expect(currentLiability).toBeDefined();
    expect(currentLiability!.displayValue).toBe(5_000);
    expect(currentLiability!.type).toBe("positive");
  });

  it("marks negative changes with type 'negative'", () => {
    const data: WaterfallData = {
      startNetWorth: 100_000,
      endNetWorth: 90_000,
      categories: [
        {
          categoryId: 1,
          categoryName: "Current Asset",
          startBalance: 50_000,
          endBalance: 40_000,
          change: -10_000,
        },
      ],
    };

    const bars = buildWaterfallBars(data);
    const assetBar = bars.find((b) => b.name === "Current Asset");

    expect(assetBar!.type).toBe("negative");
    expect(assetBar!.displayValue).toBe(-10_000);
  });

  it("computes base values so bars stack correctly", () => {
    const data: WaterfallData = {
      startNetWorth: 100_000,
      endNetWorth: 120_000,
      categories: [
        {
          categoryId: 1,
          categoryName: "Category A",
          startBalance: 60_000,
          endBalance: 75_000,
          change: 15_000,
        },
        {
          categoryId: 5,
          categoryName: "Category B",
          startBalance: -10_000,
          endBalance: -5_000,
          change: 5_000,
        },
      ],
    };

    const bars = buildWaterfallBars(data);
    // Start: base=0, value=100_000
    // Category A: positive +15_000, base=100_000 (running total), value=15_000
    // Category B: positive +5_000, base=115_000 (running total), value=5_000
    // End: base=0, value=120_000

    const catA = bars.find((b) => b.name === "Category A")!;
    expect(catA.base).toBe(100_000);
    expect(catA.value).toBe(15_000);

    const catB = bars.find((b) => b.name === "Category B")!;
    expect(catB.base).toBe(115_000);
    expect(catB.value).toBe(5_000);
  });

  it("handles negative change bars correctly (base drops)", () => {
    const data: WaterfallData = {
      startNetWorth: 100_000,
      endNetWorth: 80_000,
      categories: [
        {
          categoryId: 1,
          categoryName: "Shrinking",
          startBalance: 50_000,
          endBalance: 30_000,
          change: -20_000,
        },
      ],
    };

    const bars = buildWaterfallBars(data);
    const shrinking = bars.find((b) => b.name === "Shrinking")!;

    // Negative: base = runningTotal + change = 100_000 + (-20_000) = 80_000
    expect(shrinking.base).toBe(80_000);
    expect(shrinking.value).toBe(20_000);
    expect(shrinking.type).toBe("negative");
  });

  it("handles empty categories (no changes)", () => {
    const data: WaterfallData = {
      startNetWorth: 50_000,
      endNetWorth: 50_000,
      categories: [],
    };

    const bars = buildWaterfallBars(data);

    expect(bars).toHaveLength(2); // Start + End only
    expect(bars[0].type).toBe("start");
    expect(bars[1].type).toBe("end");
  });
});
