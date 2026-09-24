import type {
  LiquidityClass,
  LiquidityData,
} from "@/lib/queries/assets-drilldown";

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
