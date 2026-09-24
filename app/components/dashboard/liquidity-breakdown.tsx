import type { LiquidityData } from "@/lib/queries/assets-drilldown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildLiquidityTiles } from "@/components/dashboard/liquidity-tiles";
import { formatCurrency } from "@/lib/format/financial";

interface LiquidityBreakdownProps {
  data: LiquidityData;
}

export function LiquidityBreakdown({ data }: LiquidityBreakdownProps) {
  const tiles = buildLiquidityTiles(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Liquidity Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`grid gap-3 ${
            tiles.length === 5
              ? "grid-cols-2 md:grid-cols-5"
              : "grid-cols-2 md:grid-cols-4"
          }`}
        >
          {tiles.map((tile) => (
            <div
              key={tile.liquidityClass}
              data-testid={`liquidity-tile-${tile.liquidityClass}`}
              className="rounded-lg border p-3"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: tile.color }}
                  aria-hidden
                />
                <span>{tile.label}</span>
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
          aria-label="Liquidity distribution"
        >
          {tiles.map((tile) => {
            if (tile.percent <= 0) return null;
            return (
              <div
                key={tile.liquidityClass}
                data-testid={`liquidity-bar-${tile.liquidityClass}`}
                style={{
                  width: `${tile.percent}%`,
                  backgroundColor: tile.color,
                }}
                title={`${tile.label}: ${tile.percent.toFixed(1)}%`}
              />
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground">
          Total: <span className="font-medium tabular-nums text-foreground">{formatCurrency(data.total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
