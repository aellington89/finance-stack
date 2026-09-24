"use client";

import type React from "react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AccountingTimeSeriesPoint, TimeGrouping } from "@/lib/queries/accounting";
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
import {
  formatCurrency,
  formatCurrencyCompact,
} from "@/lib/format/financial";
import {
  makeTickFormatter,
  makeTooltipLabelFormatter,
} from "@/components/charts/accounting-axis";

const COLORS = {
  income: "#2eb88a",
  expenses: "#2662d9",
  investments: "#e23670",
};

const METRIC_KEYS = ["totalIncome", "totalExpenses", "totalInvestments"] as const;

const chartConfig: ChartConfig = {
  totalIncome: { label: "Total Income", color: COLORS.income },
  totalExpenses: { label: "Total Expenses", color: COLORS.expenses },
  totalInvestments: { label: "Total Investments", color: COLORS.investments },
};

const TOOLTIP_LABELS: Record<string, string> = {
  totalIncome: "Income:",
  totalExpenses: "Expenses:",
  totalInvestments: "Investments:",
};





interface AccountingChartProps {
  data: AccountingTimeSeriesPoint[];
  timeGrouping?: TimeGrouping;
  description?: React.ReactNode;
}

export function AccountingChart({ data, timeGrouping = "month", description }: AccountingChartProps) {
  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(
    () => new Set(METRIC_KEYS)
  );
  const tickFormatter = makeTickFormatter(timeGrouping);
  const tooltipLabelFormatter = makeTooltipLabelFormatter(timeGrouping);

  const toggleMetric = (key: string) => {
    setVisibleMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow toggling off the last metric
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Totals Over Time</CardTitle>
        {description && <div className="mt-1">{description}</div>}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[5/2] w-full">
          <AreaChart data={data} margin={{ left: 8, right: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={formatCurrencyCompact}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={60}
              domain={["auto", "auto"]}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={tooltipLabelFormatter}
                  labelClassName="font-bold"
                  formatter={(value, name) => (
                    <div className="flex flex-1 justify-between gap-4">
                      <span className="font-bold">
                        {TOOLTIP_LABELS[name as string] ?? name}
                      </span>
                      <span className="tabular-nums">
                        {formatCurrency(value as number)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            {visibleMetrics.has("totalIncome") && (
              <Area
                type="monotone"
                dataKey="totalIncome"
                stroke={COLORS.income}
                fill={COLORS.income}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            )}
            {visibleMetrics.has("totalExpenses") && (
              <Area
                type="monotone"
                dataKey="totalExpenses"
                stroke={COLORS.expenses}
                fill={COLORS.expenses}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            )}
            {visibleMetrics.has("totalInvestments") && (
              <Area
                type="monotone"
                dataKey="totalInvestments"
                stroke={COLORS.investments}
                fill={COLORS.investments}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ChartContainer>
        {/* Clickable Legend */}
        <div className="flex items-center justify-center gap-4 pt-3 text-xs">
          {METRIC_KEYS.map((key) => {
            const active = visibleMetrics.has(key);
            const color = key === "totalIncome" ? COLORS.income : key === "totalExpenses" ? COLORS.expenses : COLORS.investments;
            const label = chartConfig[key]?.label;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleMetric(key)}
                className={`flex items-center gap-1.5 transition-opacity ${active ? "opacity-100" : "opacity-40 line-through"}`}
              >
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: color }}
                />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
