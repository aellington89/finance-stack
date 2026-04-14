"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import type { WaterfallData } from "@/lib/queries/net-worth-drilldown";
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

const COLORS = {
  positive: "#2eb88a",
  negative: "#e23670",
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

function getBarColor(type: WaterfallBar["type"]): string {
  if (type === "positive") return COLORS.positive;
  if (type === "negative") return COLORS.negative;
  return COLORS.neutral;
}

interface WaterfallChartProps {
  data: WaterfallData;
}

export function WaterfallChart({ data }: WaterfallChartProps) {
  const bars = buildWaterfallBars(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Net Worth Waterfall
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
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
              width={60}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(_, __, item) => {
                    const bar = item?.payload as WaterfallBar | undefined;
                    if (!bar) return null;
                    const prefix =
                      bar.type === "start" || bar.type === "end"
                        ? ""
                        : bar.displayValue >= 0
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
              }
            />
            {/* Invisible base bar */}
            <Bar dataKey="base" stackId="waterfall" fill="transparent" />
            {/* Visible value bar */}
            <Bar dataKey="value" stackId="waterfall" radius={[4, 4, 0, 0]}>
              {bars.map((bar, idx) => (
                <Cell key={idx} fill={getBarColor(bar.type)} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
