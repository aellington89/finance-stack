import type { DebtWaterfallData } from "@/lib/queries/liabilities-drilldown";

// Color semantics on the liability side:
//   payments → balance moves toward zero (good)  → green
//   interest → balance moves away from zero (bad)→ red
//   other    → can go either way; signed at runtime
export const COLORS = {
  good: "#2eb88a",
  bad: "#e23670",
  neutral: "#6b7280",
};

export interface DebtWaterfallBar {
  name: string;
  base: number;
  value: number;
  displayValue: number;
  type: "start" | "end" | "good" | "bad" | "neutral";
}

/**
 * Transforms the waterfall query result into Recharts stacked-bar shape:
 * each bar has a transparent `base` and a visible `value`. Liability
 * balances are negative throughout, so the bridge math runs naturally:
 *   start + payments + interest + other = end
 *
 * Bar `type` carries the *intent* (paydown vs. added debt) so the colorer
 * can paint without re-deriving signs:
 *   - payments are paydowns (positive on the liability side) → "good"
 *   - interest accrual is added debt (negative) → "bad"
 *   - "other" is signed: positive (paydown of unclassified change) → good,
 *     negative (e.g. new credit-card spend) → bad.
 */
export function buildDebtWaterfallBars(
  data: DebtWaterfallData
): DebtWaterfallBar[] {
  const bars: DebtWaterfallBar[] = [];

  // Start
  bars.push({
    name: "Start",
    base: Math.min(0, data.startBalance),
    value: Math.abs(data.startBalance),
    displayValue: data.startBalance,
    type: "start",
  });

  let running = data.startBalance;

  const pushChange = (
    name: string,
    delta: number,
    type: DebtWaterfallBar["type"]
  ) => {
    if (delta === 0) return;
    const isPositive = delta > 0;
    bars.push({
      name,
      base: isPositive ? running : running + delta,
      value: Math.abs(delta),
      displayValue: delta,
      type,
    });
    running += delta;
  };

  pushChange("Payments", data.payments, "good");
  pushChange("Interest", data.interestAccrued, "bad");
  pushChange("Other", data.other, data.other >= 0 ? "good" : "bad");

  // End
  bars.push({
    name: "End",
    base: Math.min(0, data.endBalance),
    value: Math.abs(data.endBalance),
    displayValue: data.endBalance,
    type: "end",
  });

  return bars;
}

export function getBarColor(type: DebtWaterfallBar["type"]): string {
  if (type === "good") return COLORS.good;
  if (type === "bad") return COLORS.bad;
  return COLORS.neutral;
}
