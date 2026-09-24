import type { LiabilityAllocationData } from "@/lib/queries/liabilities-drilldown";

// Deterministic palette for type tiles. Indexed by `account_type_id` so the
// same type always renders in the same color across loads, without
// hard-coding any specific type id.
const PALETTE = [
  "#e23670",
  "#f97316",
  "#eab308",
  "#2eb88a",
  "#2662d9",
  "#8b5cf6",
  "#06b6d4",
  "#a16207",
];

const colorForType = (typeId: number): string =>
  PALETTE[typeId % PALETTE.length];

export interface DebtMixTile {
  accountTypeId: number;
  accountTypeName: string;
  categoryId: number;
  color: string;
  value: number;
  percent: number;
}

/**
 * Flattens the allocation tree to one tile per account type with a
 * non-zero balance. Sorted from largest debt magnitude to smallest.
 */
export function buildDebtMixTiles(data: LiabilityAllocationData): DebtMixTile[] {
  const tiles: DebtMixTile[] = [];
  for (const cat of data.byCategory) {
    for (const child of cat.children) {
      if (child.value === 0) continue;
      tiles.push({
        accountTypeId: child.accountTypeId,
        accountTypeName: child.accountTypeName,
        categoryId: cat.categoryId,
        color: colorForType(child.accountTypeId),
        value: child.value,
        percent: child.percentOfTotal,
      });
    }
  }
  // Largest magnitude first.
  tiles.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return tiles;
}
