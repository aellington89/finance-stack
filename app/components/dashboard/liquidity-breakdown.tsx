import type {
  LiquidityClass,
  LiquidityData,
} from "@/lib/queries/assets-drilldown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CLASS_META: Record<
  LiquidityClass,
  { label: string; color: string; description: string }
> = {
  liquid: {
    label: "Liquid",
    color: "#2eb88a",
    description: "Cash and equivalents",
  },
  semi_liquid: {
    label: "Semi-liquid",
    color: "#2662d9",
    description: "Investments convertible within days",
  },
  illiquid: {
    label: "Illiquid",
    color: "#eab308",
    description: "Property, retirement, long-hold assets",
  },
  restricted: {
    label: "Restricted",
    color: "#8b5cf6",
    description: "Escrow, deposits, earmarked",
  },
  unclassified: {
    label: "Unclassified",
    color: "#6b7280",
    description: "Missing liquidity classification",
  },
};

const DISPLAY_ORDER: LiquidityClass[] = [
  "liquid",
  "semi_liquid",
  "illiquid",
  "restricted",
  "unclassified",
];

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

export interface LiquidityTile {
  liquidityClass: LiquidityClass;
  label: string;
  color: string;
  value: number;
  percent: number;
  hasData: boolean;
}

/**
 * Projects raw LiquidityData into the display-ready tile list used by the
 * component. The "unclassified" bucket is only included when present in the
 * data; the other four always render (as 0% if absent).
 */
export function buildLiquidityTiles(data: LiquidityData): LiquidityTile[] {
  const byClass = new Map(data.classes.map((c) => [c.liquidityClass, c]));
  const keys = DISPLAY_ORDER.filter((k) =>
    k === "unclassified" ? byClass.has(k) : true
  );
  return keys.map((klass) => {
    const meta = CLASS_META[klass];
    const bucket = byClass.get(klass);
    return {
      liquidityClass: klass,
      label: meta.label,
      color: meta.color,
      value: bucket?.value ?? 0,
      percent: bucket?.percent ?? 0,
      hasData: bucket != null,
    };
  });
}

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
