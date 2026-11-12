import type { LiabilityAllocationData } from "@/lib/queries/liabilities-drilldown";
import { pct, round2 } from "@/lib/queries/_percent";

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

export type DebtMixSegment = "balance_transfer" | "revolving";

export interface DebtMixTile {
  accountTypeId: number;
  accountTypeName: string;
  categoryId: number;
  color: string;
  value: number;
  percent: number;
  /**
   * Set only on the halves of a type split by promo status (Issue #417). An
   * unsplit tile has no segment, so it is exactly what it was before.
   */
  segment?: DebtMixSegment;
}

const SEGMENT_LABEL: Record<DebtMixSegment, string> = {
  balance_transfer: "balance transfer",
  revolving: "revolving",
};

/**
 * A tile's identity for React keys and test ids. An unsplit tile keeps its
 * bare type id, so `debt-mix-tile-15` still means the Credit Card tile.
 */
export const debtMixTileKey = (tile: DebtMixTile): string =>
  tile.segment ? `${tile.accountTypeId}-${tile.segment}` : String(tile.accountTypeId);

/**
 * Flattens the allocation tree to one tile per account type with a
 * non-zero balance. Sorted from largest debt magnitude to smallest.
 *
 * A type with balance left on an active balance transfer (Issues #417 and
 * #427) becomes two tiles instead, "‹type› — balance transfer" and
 * "‹type› — revolving". The first is what is left on the transfers, and the
 * second everything else on the type's accounts, purchases included. The split
 * is within each type, so this never needs to know which user-defined type
 * means "credit card". A half with no balance is dropped like any other zero
 * tile. Both halves keep the type's colour; the label is what tells them apart.
 */
export function buildDebtMixTiles(data: LiabilityAllocationData): DebtMixTile[] {
  const tiles: DebtMixTile[] = [];
  for (const cat of data.byCategory) {
    for (const child of cat.children) {
      if (child.hasActivePromo) {
        const promo = child.promoValue ?? 0;
        const halves: [DebtMixSegment, number][] = [
          ["balance_transfer", promo],
          // Cents, so float noise in the subtraction cannot leave a $0.00 tile.
          ["revolving", round2(child.value - promo)],
        ];
        for (const [segment, value] of halves) {
          if (value === 0) continue;
          tiles.push({
            accountTypeId: child.accountTypeId,
            accountTypeName: `${child.accountTypeName} — ${SEGMENT_LABEL[segment]}`,
            categoryId: cat.categoryId,
            color: colorForType(child.accountTypeId),
            value,
            percent: pct(value, data.totalLiabilities),
            segment,
          });
        }
        continue;
      }
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
