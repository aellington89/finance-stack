import { describe, it, expect } from "vitest";
import { buildDebtMixTiles, debtMixTileKey } from "@/components/dashboard/debt-mix-tiles";
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

// Issue #417: a type with an account on an active balance-transfer promo splits
// into a balance-transfer tile and a revolving tile. Every other type is left
// exactly as the cases above describe it.
describe("buildDebtMixTiles — promo split", () => {
  const split = (
    promoValue: number,
    value = -3000
  ): LiabilityAllocationData =>
    makeData(
      [
        {
          categoryId: 5,
          categoryName: "Current Liability",
          value,
          percentOfTotal: 60,
          children: [
            {
              accountTypeId: 15,
              accountTypeName: "Credit Card",
              value,
              percentOfParent: 100,
              percentOfTotal: 60,
              hasActivePromo: true,
              promoValue,
            },
          ],
        },
        {
          categoryId: 6,
          categoryName: "Non-current Liability",
          value: -2000,
          percentOfTotal: 40,
          children: [
            {
              accountTypeId: 19,
              accountTypeName: "Auto Loan",
              value: -2000,
              percentOfParent: 100,
              percentOfTotal: 40,
            },
          ],
        },
      ],
      value - 2000
    );

  it("splits a type with an active promo into its two halves", () => {
    const tiles = buildDebtMixTiles(split(-1200));

    expect(tiles.map((t) => [t.accountTypeName, t.value, t.percent, t.segment])).toEqual([
      ["Auto Loan", -2000, 40, undefined],
      ["Credit Card — revolving", -1800, 36, "revolving"],
      ["Credit Card — balance transfer", -1200, 24, "balance_transfer"],
    ]);
    // Both halves keep the type's colour.
    expect(tiles[1].color).toBe(tiles[2].color);
  });

  it("keys the halves apart, and leaves an unsplit tile's key as it was", () => {
    const keys = buildDebtMixTiles(split(-1200)).map(debtMixTileKey);
    expect(keys).toEqual(["19", "15-revolving", "15-balance_transfer"]);
  });

  it("drops a half with nothing in it", () => {
    // Every card of the type is promotional.
    expect(buildDebtMixTiles(split(-3000)).map((t) => t.accountTypeName)).toEqual([
      "Credit Card — balance transfer",
      "Auto Loan",
    ]);
    // The promotional card is paid off.
    expect(buildDebtMixTiles(split(0)).map((t) => t.accountTypeName)).toEqual([
      "Credit Card — revolving",
      "Auto Loan",
    ]);
  });

  it("does not leave a sub-cent revolving tile from float noise", () => {
    const tiles = buildDebtMixTiles(split(-0.3, -0.1 - 0.2));
    expect(tiles.map((t) => t.segment)).toEqual([undefined, "balance_transfer"]);
  });
});
