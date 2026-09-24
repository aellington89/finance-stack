"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AssetDecompositionPoint } from "@/lib/queries/assets-drilldown";
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
import { formatAxisDate } from "@/lib/format/dates";
import { pivotByCategory } from "@/components/charts/timeseries-pivot";

const CATEGORY_COLORS: Record<number, string> = {
  1: "#2eb88a",
  2: "#8b5cf6",
  3: "#eab308",
  4: "#2662d9",
};


interface AssetsTimeSeriesChartProps {
  decomposition: AssetDecompositionPoint[];
}

export function AssetsTimeSeriesChart({
  decomposition,
}: AssetsTimeSeriesChartProps) {
  const { rows, series } = useMemo(
    () => pivotByCategory(decomposition, CATEGORY_COLORS),
    [decomposition]
  );

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }])
  );

  const isEmpty = rows.length === 0;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Assets Over Time (by category)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {isEmpty ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No asset balance history in the selected range.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="min-h-0 flex-1 w-full">
            <AreaChart data={rows} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatAxisDate}
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
                    labelFormatter={(_, payload) => {
                      if (!payload?.[0]?.payload?.date) return "";
                      const d = new Date(
                        payload[0].payload.date + "T00:00:00"
                      );
                      return format(d, "MMM d, yyyy");
                    }}
                    formatter={(value, name) => (
                      <div className="flex flex-1 justify-between gap-4">
                        <span className="font-bold">
                          {chartConfig[name as string]?.label ?? name}:
                        </span>
                        <span className="tabular-nums">
                          {formatCurrency(value as number)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="assets"
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={0.4}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3 text-xs text-muted-foreground">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
