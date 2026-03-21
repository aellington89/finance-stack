"use client";

import type React from "react";
import { useState } from "react";
import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { WorkExpenseTimeSeriesPoint } from "@/lib/queries/work-expenses";
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
  expenses: "#2662d9",
  reimbursements: "#2eb88a",
};

const METRIC_KEYS = ["totalExpenses", "totalReimbursements"] as const;

const chartConfig: ChartConfig = {
  totalExpenses: { label: "Work Expenses", color: COLORS.expenses },
  totalReimbursements: { label: "Reimbursements", color: COLORS.reimbursements },
};

const TOOLTIP_LABELS: Record<string, string> = {
  totalExpenses: "Expenses:",
  totalReimbursements: "Reimbursements:",
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

function parseDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00");
}

interface WorkExpensesChartProps {
  data: WorkExpenseTimeSeriesPoint[];
  description?: React.ReactNode;
}

export function WorkExpensesChart({ data, description }: WorkExpensesChartProps) {
  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(
    () => new Set(METRIC_KEYS)
  );

  const toggleMetric = (key: string) => {
    setVisibleMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
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
        <CardTitle className="text-sm font-medium">Expenses vs Reimbursements Over Time</CardTitle>
        {description && <div className="mt-1">{description}</div>}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[5/2] w-full">
          <BarChart data={data} margin={{ left: 8, right: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(dateStr: string) => format(parseDate(dateStr), "MMM yyyy")}
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
                  labelFormatter={(_: unknown, payload: Array<{ payload?: { date?: string } }>) => {
                    if (!payload?.[0]?.payload?.date) return "";
                    return format(parseDate(payload[0].payload.date), "MMMM yyyy");
                  }}
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
            {visibleMetrics.has("totalExpenses") && (
              <Bar
                dataKey="totalExpenses"
                fill={COLORS.expenses}
                radius={[4, 4, 0, 0]}
              />
            )}
            {visibleMetrics.has("totalReimbursements") && (
              <Bar
                dataKey="totalReimbursements"
                fill={COLORS.reimbursements}
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        </ChartContainer>
        {/* Clickable Legend */}
        <div className="flex items-center justify-center gap-4 pt-3 text-xs">
          {METRIC_KEYS.map((key) => {
            const active = visibleMetrics.has(key);
            const color = COLORS[key === "totalExpenses" ? "expenses" : "reimbursements"];
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
