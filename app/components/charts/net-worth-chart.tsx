"use client";

import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
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
  href?: string;
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
  href,
}: TimeSeriesChartProps) {
  const chartConfig: ChartConfig = {
    [dataKey]: {
      label: title,
      color,
    },
  };

  const card = (
    <Card
      className={
        href
          ? "h-full cursor-pointer transition-shadow hover:ring-2 hover:ring-primary/40 hover:shadow-md"
          : undefined
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>{title}</span>
          {href ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover/chart-link:translate-x-0.5" />
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
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

  if (href) {
    return (
      <Link href={href} className="group/chart-link block">
        {card}
      </Link>
    );
  }

  return card;
}
