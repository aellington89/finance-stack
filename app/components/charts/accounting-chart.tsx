"use client";

import type React from "react";
import { useState } from "react";
import { addDays, format, getQuarter } from "date-fns";
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

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00");
}

function formatDotDate(d: Date) {
  return `${d.getMonth() + 1}.${d.getDate()}.${d.getFullYear()}`;
}

function makeTickFormatter(grouping: TimeGrouping) {
  if (grouping === "day") {
    return (dateStr: string) => format(parseDate(dateStr), "MMM d");
  }
  if (grouping === "week") {
    // Show last day of week period
    return (dateStr: string) => {
      const end = addDays(parseDate(dateStr), 6);
      return format(end, "MMM d");
    };
  }
  if (grouping === "month") {
    return (dateStr: string) => format(parseDate(dateStr), "MMMM yyyy");
  }
  if (grouping === "quarter") {
    return (dateStr: string) => {
      const d = parseDate(dateStr);
      return `Q${getQuarter(d)} ${d.getFullYear()}`;
    };
  }
  if (grouping === "year") {
    return (dateStr: string) => format(parseDate(dateStr), "yyyy");
  }
  if (grouping === "day_of_week") {
    return (val: string) => DOW_NAMES[Number(val)] ?? val;
  }
  if (grouping === "month_of_year") {
    return (val: string) => MONTH_NAMES[Number(val)] ?? val;
  }
  if (grouping === "quarter_of_year") {
    return (val: string) => `Q${val}`;
  }
  // day_of_month, day_of_year, week_of_year — just show the number
  return (val: string) => val;
}

function makeTooltipLabelFormatter(grouping: TimeGrouping) {
  if (grouping === "day") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) => {
      if (!payload?.[0]?.payload?.date) return "";
      return format(parseDate(payload[0].payload.date), "MMM d, yyyy");
    };
  }
  if (grouping === "week") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) => {
      if (!payload?.[0]?.payload?.date) return "";
      const start = parseDate(payload[0].payload.date);
      const end = addDays(start, 6);
      return `${formatDotDate(start)} - ${formatDotDate(end)}`;
    };
  }
  if (grouping === "month") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) => {
      if (!payload?.[0]?.payload?.date) return "";
      return format(parseDate(payload[0].payload.date), "MMMM yyyy");
    };
  }
  if (grouping === "quarter") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) => {
      if (!payload?.[0]?.payload?.date) return "";
      const d = parseDate(payload[0].payload.date);
      return `Q${getQuarter(d)} ${d.getFullYear()}`;
    };
  }
  if (grouping === "year") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) => {
      if (!payload?.[0]?.payload?.date) return "";
      return format(parseDate(payload[0].payload.date), "yyyy");
    };
  }
  if (grouping === "day_of_week") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) =>
      DOW_NAMES[Number(payload?.[0]?.payload?.date)] ?? String(payload?.[0]?.payload?.date);
  }
  if (grouping === "month_of_year") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) =>
      MONTH_NAMES[Number(payload?.[0]?.payload?.date)] ?? String(payload?.[0]?.payload?.date);
  }
  if (grouping === "quarter_of_year") {
    return (_: unknown, payload: Array<{ payload?: { date?: string } }>) =>
      `Q${payload?.[0]?.payload?.date}`;
  }
  return (_: unknown, payload: Array<{ payload?: { date?: string } }>) =>
    String(payload?.[0]?.payload?.date ?? "");
}

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
                        {formatCurrencyFull(value as number)}
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
