import type { WaterfallData } from "@/lib/queries/net-worth-drilldown";

export const COLORS = {
  positive: "#2eb88a",
  negative: "#e23670",
  neutral: "#6b7280",
};

export interface WaterfallBar {
  name: string;
  base: number;
  value: number;
  displayValue: number;
  type: "start" | "end" | "positive" | "negative";
}

/**
 * Transforms waterfall query data into the stacked bar format
 * Recharts needs: each bar has a transparent `base` and a visible `value`.
 */
export function buildWaterfallBars(data: WaterfallData): WaterfallBar[] {
  const bars: WaterfallBar[] = [];

  // Starting bar
  const startVal = data.startNetWorth;
  bars.push({
    name: "Start",
    base: Math.min(0, startVal),
    value: Math.abs(startVal),
    displayValue: startVal,
    type: "start",
  });

  // Category change bars
  let runningTotal = startVal;
  for (const cat of data.categories) {
    if (cat.change === 0) continue;
    const isPositive = cat.change > 0;
    bars.push({
      name: cat.categoryName,
      base: isPositive ? runningTotal : runningTotal + cat.change,
      value: Math.abs(cat.change),
      displayValue: cat.change,
      type: isPositive ? "positive" : "negative",
    });
    runningTotal += cat.change;
  }

  // Ending bar
  const endVal = data.endNetWorth;
  bars.push({
    name: "End",
    base: Math.min(0, endVal),
    value: Math.abs(endVal),
    displayValue: endVal,
    type: "end",
  });

  return bars;
}

export function getBarColor(type: WaterfallBar["type"]): string {
  if (type === "positive") return COLORS.positive;
  if (type === "negative") return COLORS.negative;
  return COLORS.neutral;
}
