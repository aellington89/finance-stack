"use client";

import type React from "react";
import { Cell, Label, Pie, PieChart } from "recharts";
import type { CategoryBreakdown } from "@/lib/queries/accounting";
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

// Distinct palette for up to 12 slices + an "Other" gray
const SLICE_COLORS = [
  "#2662d9",
  "#2eb88a",
  "#e23670",
  "#eab308",
  "#8b5cf6",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#6366f1",
  "#14b8a6",
  "#f43f5e",
];
const OTHER_COLOR = "#6b7280";

const formatCurrencyFull = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

interface ExpensesCategoryChartProps {
  data: CategoryBreakdown[];
  title?: string;
  description?: React.ReactNode;
}

export function ExpensesCategoryChart({ data, title = "Total Expenses by Category", description }: ExpensesCategoryChartProps) {
  const grandTotal = data.reduce((sum, d) => sum + d.total, 0);

  // Top 10 categories + "Other" bucket
  const top = data.slice(0, 10);
  const otherTotal = data.slice(10).reduce((sum, d) => sum + d.total, 0);
  const chartData =
    otherTotal > 0
      ? [...top, { category: "Other", total: otherTotal }]
      : top;

  // Build chart config for legend / tooltip labels
  const chartConfig: ChartConfig = Object.fromEntries(
    chartData.map((d, i) => [
      d.category,
      {
        label: d.category,
        color: d.category === "Other" ? OTHER_COLOR : (SLICE_COLORS[i % SLICE_COLORS.length]),
      },
    ])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {title}
        </CardTitle>
        {description && <div className="mt-1">{description}</div>}
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <ChartContainer
          config={chartConfig}
          className="aspect-[4/3] w-full"
        >
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex flex-1 justify-between gap-4">
                      <span className="font-bold">{name}:</span>
                      <span className="tabular-nums">
                        {formatCurrencyFull(value as number)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Pie
              data={chartData}
              dataKey="total"
              nameKey="category"
              innerRadius="48%"
              outerRadius="80%"
              paddingAngle={1}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.category}
                  fill={
                    entry.category === "Other"
                      ? OTHER_COLOR
                      : SLICE_COLORS[i % SLICE_COLORS.length]
                  }
                />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) - 12}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {formatCurrencyFull(grandTotal)}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 14}
                          className="fill-muted-foreground text-sm"
                        >
                          Total
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>

        {/* Legend */}
        <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {chartData.map((entry, i) => {
            const pct =
              grandTotal > 0
                ? ((entry.total / grandTotal) * 100).toFixed(2)
                : "0.00";
            return (
              <div key={entry.category} className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{
                    backgroundColor:
                      entry.category === "Other"
                        ? OTHER_COLOR
                        : SLICE_COLORS[i % SLICE_COLORS.length],
                  }}
                />
                <span className="text-muted-foreground truncate">
                  {entry.category}
                </span>
                <span className="ml-auto tabular-nums font-medium">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
