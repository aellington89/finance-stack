import { describe, it, expect } from "vitest";
import { buildDebtMixTiles } from "@/components/dashboard/debt-mix-breakdown";
import type { LiabilityAllocationData } from "@/lib/queries/liabilities-drilldown";

const makeData = (
  byCategory: LiabilityAllocationData["byCategory"],
  totalLiabilities: number
): LiabilityAllocationData => ({
  totalLiabilities,
  currentLiabilities: 0,
  nonCurrentLiabilities: 0,
  asOf: "2026-05-02",
  byCategory,
});

describe("buildDebtMixTiles", () => {
  it("flattens category tree into one tile per non-zero account type", () => {
    const data = makeData(
      [
        {
          categoryId: 5,
          categoryName: "Current Liability",
          value: -1000,
          percentOfTotal: 25,
          children: [
            {
              accountTypeId: 15,
              accountTypeName: "Credit Card",
              value: -1000,
              percentOfParent: 100,
              percentOfTotal: 25,
            },
          ],
        },
        {
          categoryId: 6,
          categoryName: "Non-current Liability",
          value: -3000,
          percentOfTotal: 75,
          children: [
            {
              accountTypeId: 17,
              accountTypeName: "Mortgage",
              value: -2000,
              percentOfParent: 66.67,
              percentOfTotal: 50,
            },
            {
              accountTypeId: 19,
              accountTypeName: "Auto Loan",
              value: -1000,
              percentOfParent: 33.33,
              percentOfTotal: 25,
            },
          ],
        },
      ],
      -4000
    );

    const tiles = buildDebtMixTiles(data);

    expect(tiles).toHaveLength(3);
    // Largest magnitude first.
    expect(tiles[0].accountTypeName).toBe("Mortgage");
    expect(tiles[1].percent).toBe(25);
    expect(tiles[2].percent).toBe(25);
  });

  it("excludes account types with a zero balance", () => {
    const data = makeData(
      [
        {
          categoryId: 5,
          categoryName: "Current Liability",
          value: -100,
          percentOfTotal: 100,
          children: [
            {
              accountTypeId: 15,
              accountTypeName: "Credit Card",
              value: -100,
              percentOfParent: 100,
              percentOfTotal: 100,
            },
            {
              accountTypeId: 16,
              accountTypeName: "Short-term Loan",
              value: 0,
              percentOfParent: 0,
              percentOfTotal: 0,
            },
          ],
        },
      ],
      -100
    );

    const tiles = buildDebtMixTiles(data);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].accountTypeName).toBe("Credit Card");
  });

  it("returns an empty list when there are no liabilities", () => {
    const data = makeData([], 0);
    expect(buildDebtMixTiles(data)).toHaveLength(0);
  });

  it("assigns deterministic colors per accountTypeId", () => {
    const data = makeData(
      [
        {
          categoryId: 5,
          categoryName: "Current Liability",
          value: -100,
          percentOfTotal: 100,
          children: [
            {
              accountTypeId: 15,
              accountTypeName: "Credit Card",
              value: -100,
              percentOfParent: 100,
              percentOfTotal: 100,
            },
          ],
        },
      ],
      -100
    );

    const tilesA = buildDebtMixTiles(data);
    const tilesB = buildDebtMixTiles(data);
    expect(tilesA[0].color).toBe(tilesB[0].color);
  });
});
