"use client";

import { format } from "date-fns";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { TimeSeriesPoint } from "@/lib/queries/dashboard";
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

interface TimeSeriesChartProps {
  title: string;
  data: TimeSeriesPoint[];
  dataKey: "netWorth" | "totalAssets" | "totalLiabilities";
  color: string;
}

// Compact format for Y-axis ticks (e.g. "$300K")
const formatCurrencyCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

// Full precision for tooltips (e.g. "$292,229.40")
const formatCurrencyFull = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  return format(d, "MMM d");
};

export function TimeSeriesChart({
  title,
  data,
  dataKey,
  color,
}: TimeSeriesChartProps) {
  const chartConfig: ChartConfig = {
    [dataKey]: {
      label: title,
      color,
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[4/3] w-full">
          <LineChart data={data} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
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
                    const d = new Date(payload[0].payload.date + "T00:00:00");
                    return format(d, "MMM d, yyyy");
                  }}
                  formatter={(value) => formatCurrencyFull(value as number)}
                />
              }
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
