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
import {
  COLORS,
  buildWaterfallBars,
  getBarColor,
  type WaterfallBar,
} from "@/components/charts/waterfall-bars";
import {
  formatCurrency,
  formatCurrencyCompact,
} from "@/lib/format/financial";

const chartConfig: ChartConfig = {
  value: { label: "Change", color: COLORS.neutral },
};

interface WaterfallChartProps {
  data: WaterfallData;
}

export function WaterfallChart({ data }: WaterfallChartProps) {
  const bars = buildWaterfallBars(data);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Net Worth Waterfall
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
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
              width={60}
            />
            <ChartTooltip
              content={({ active, payload, label }) => (
                <ChartTooltipContent
                  active={active}
                  label={label}
                  payload={payload?.filter((p) => p.dataKey === "value")}
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
                        {formatCurrency(bar.displayValue)}
                      </span>
                    );
                  }}
                  labelFormatter={(label) => String(label)}
                />
              )}
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
