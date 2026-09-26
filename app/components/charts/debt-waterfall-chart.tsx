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
import {
  COLORS,
  buildDebtWaterfallBars,
  getBarColor,
  type DebtWaterfallBar,
} from "@/components/charts/debt-waterfall-bars";
import { buildWaterfallAxis } from "@/components/charts/waterfall-axis";
import {
  formatCurrency,
  formatCurrencyCompact,
} from "@/lib/format/financial";

const chartConfig: ChartConfig = {
  value: { label: "Change", color: COLORS.neutral },
};

interface DebtWaterfallChartProps {
  data: DebtWaterfallData;
}

export function DebtWaterfallChart({ data }: DebtWaterfallChartProps) {
  const bars = buildDebtWaterfallBars(data);
  // Zooms to the bridge when the balance would dwarf it. It is null, and the
  // axis keeps recharts' defaults, when it would not (#251).
  const axis = buildWaterfallAxis(bars);
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
                domain={axis?.domain}
                ticks={axis?.ticks}
                allowDataOverflow={axis !== null}
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
                          {formatCurrency(bar.displayValue)}
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
