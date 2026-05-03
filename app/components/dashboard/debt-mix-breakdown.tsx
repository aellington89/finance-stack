import type { LiabilityAllocationData } from "@/lib/queries/liabilities-drilldown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

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

interface DebtMixBreakdownProps {
  data: LiabilityAllocationData;
}

export function DebtMixBreakdown({ data }: DebtMixBreakdownProps) {
  const tiles = buildDebtMixTiles(data);

  if (tiles.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Debt Mix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No outstanding liabilities.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Cap the grid at 5 columns on desktop; the tile count varies by deployment.
  // Static class strings only — Tailwind cannot purge dynamic class names.
  const colsClass = (() => {
    switch (Math.min(tiles.length, 5)) {
      case 1:
        return "grid-cols-1";
      case 2:
        return "grid-cols-2";
      case 3:
        return "grid-cols-2 md:grid-cols-3";
      case 4:
        return "grid-cols-2 md:grid-cols-4";
      default:
        return "grid-cols-2 md:grid-cols-5";
    }
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Debt Mix</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`grid gap-3 ${colsClass}`}>
          {tiles.map((tile) => (
            <div
              key={tile.accountTypeId}
              data-testid={`debt-mix-tile-${tile.accountTypeId}`}
              className="rounded-lg border p-3"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: tile.color }}
                  aria-hidden
                />
                <span>{tile.accountTypeName}</span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
                {formatCurrency(tile.value)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {tile.percent.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label="Debt mix distribution"
        >
          {tiles.map((tile) => {
            if (tile.percent <= 0) return null;
            return (
              <div
                key={tile.accountTypeId}
                data-testid={`debt-mix-bar-${tile.accountTypeId}`}
                style={{
                  width: `${tile.percent}%`,
                  backgroundColor: tile.color,
                }}
                title={`${tile.accountTypeName}: ${tile.percent.toFixed(1)}%`}
              />
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground">
          Total:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(data.totalLiabilities)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
