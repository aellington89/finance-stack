"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import type { DebtWaterfallData } from "@/lib/queries/liabilities-drilldown";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Color semantics on the liability side:
//   payments → balance moves toward zero (good)  → green
//   interest → balance moves away from zero (bad)→ red
//   other    → can go either way; signed at runtime
const COLORS = {
  good: "#2eb88a",
  bad: "#e23670",
  neutral: "#6b7280",
};

const chartConfig: ChartConfig = {
  value: { label: "Change", color: COLORS.neutral },
};

const formatCurrencyCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const formatCurrencyFull = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

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

function getBarColor(type: DebtWaterfallBar["type"]): string {
  if (type === "good") return COLORS.good;
  if (type === "bad") return COLORS.bad;
  return COLORS.neutral;
}

interface DebtWaterfallChartProps {
  data: DebtWaterfallData;
}

export function DebtWaterfallChart({ data }: DebtWaterfallChartProps) {
  const bars = buildDebtWaterfallBars(data);
  const isEmpty = data.startBalance === 0 && data.endBalance === 0;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Debt Waterfall</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {isEmpty ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No liability activity in the selected range.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="min-h-0 flex-1 w-full">
            <BarChart data={bars} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={0}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickFormatter={formatCurrencyCompact}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={70}
              />
              <ChartTooltip
                content={({ active, payload, label }) => (
                  <ChartTooltipContent
                    active={active}
                    label={label}
                    payload={payload?.filter((p) => p.dataKey === "value")}
                    formatter={(_, __, item) => {
                      const bar = item?.payload as DebtWaterfallBar | undefined;
                      if (!bar) return null;
                      const prefix =
                        bar.type === "start" || bar.type === "end"
                          ? ""
                          : bar.displayValue > 0
                            ? "+"
                            : "";
                      return (
                        <span className="font-bold tabular-nums">
                          {prefix}
                          {formatCurrencyFull(bar.displayValue)}
                        </span>
                      );
                    }}
                    labelFormatter={(label) => String(label)}
                  />
                )}
              />
              <Bar dataKey="base" stackId="waterfall" fill="transparent" />
              <Bar dataKey="value" stackId="waterfall" radius={[4, 4, 0, 0]}>
                {bars.map((bar, idx) => (
                  <Cell key={idx} fill={getBarColor(bar.type)} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
