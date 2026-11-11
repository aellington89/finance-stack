import type { CSSProperties } from "react";
import type { LiabilityAllocationData } from "@/lib/queries/liabilities-drilldown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  buildDebtMixTiles,
  debtMixTileKey,
  type DebtMixTile,
} from "@/components/dashboard/debt-mix-tiles";
import { formatCurrency } from "@/lib/format/financial";

interface DebtMixBreakdownProps {
  data: LiabilityAllocationData;
}

// The balance-transfer half of a split type (Issue #417) is drawn in the
// type's colour with light stripes over it, so it reads as part of the same
// type next to its revolving half. The label carries the distinction for
// anyone who cannot see the stripes; the pattern only repeats it.
const fillFor = (tile: DebtMixTile): CSSProperties =>
  tile.segment === "balance_transfer"
    ? {
        backgroundColor: tile.color,
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 3px, rgba(255, 255, 255, 0.5) 3px 5px)",
      }
    : { backgroundColor: tile.color };

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
              key={debtMixTileKey(tile)}
              data-testid={`debt-mix-tile-${debtMixTileKey(tile)}`}
              className="rounded-lg border p-3"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={fillFor(tile)}
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
                key={debtMixTileKey(tile)}
                data-testid={`debt-mix-bar-${debtMixTileKey(tile)}`}
                style={{
                  width: `${tile.percent}%`,
                  ...fillFor(tile),
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
