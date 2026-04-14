"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { TimeSeriesPoint } from "@/lib/queries/dashboard";
import type { DecompositionPoint } from "@/lib/queries/net-worth-drilldown";
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

const NET_WORTH_COLOR = "#2eb88a";

const PALETTE = [
  "#2eb88a", "#2662d9", "#e23670", "#eab308",
  "#8b5cf6", "#f97316", "#06b6d4", "#ec4899",
  "#84cc16", "#6366f1", "#14b8a6", "#f43f5e",
];

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

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  return format(d, "MMM d");
};

type Mode = "net-worth" | "category" | "account";

interface SeriesInfo {
  key: string;
  label: string;
  color: string;
}

interface PivotedRow {
  date: string;
  [seriesKey: string]: number | string;
}

function pivotDecomposition(
  points: DecompositionPoint[],
  mode: "category" | "account"
): { rows: PivotedRow[]; series: SeriesInfo[] } {
  const seriesMap = new Map<string, string>();
  for (const p of points) {
    if (mode === "category") {
      const key = `cat_${p.categoryId}`;
      if (!seriesMap.has(key)) seriesMap.set(key, p.categoryName);
    } else {
      const key = `acct_${p.accountId}`;
      if (!seriesMap.has(key)) seriesMap.set(key, p.accountName);
    }
  }

  const series: SeriesInfo[] = Array.from(seriesMap.entries()).map(
    ([key, label], i) => ({
      key,
      label,
      color: PALETTE[i % PALETTE.length],
    })
  );

  const dateMap = new Map<string, PivotedRow>();
  for (const p of points) {
    if (!dateMap.has(p.date)) {
      const row: PivotedRow = { date: p.date };
      for (const s of series) row[s.key] = 0;
      dateMap.set(p.date, row);
    }
    const row = dateMap.get(p.date)!;
    const key =
      mode === "category" ? `cat_${p.categoryId}` : `acct_${p.accountId}`;
    row[key] = ((row[key] as number) || 0) + p.cumulativeBalance;
  }

  const rows = Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return { rows, series };
}

interface NetWorthTimeSeriesChartProps {
  timeSeries: TimeSeriesPoint[];
  decomposition: DecompositionPoint[];
}

export function NetWorthTimeSeriesChart({
  timeSeries,
  decomposition,
}: NetWorthTimeSeriesChartProps) {
  const [mode, setMode] = useState<Mode>("net-worth");
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(
    () => new Set()
  );

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setHiddenSeries(new Set());
  };

  const decomposed = useMemo(
    () =>
      mode !== "net-worth"
        ? pivotDecomposition(decomposition, mode)
        : { rows: [], series: [] },
    [decomposition, mode]
  );

  // Build chart config for the active mode
  const chartConfig: ChartConfig =
    mode === "net-worth"
      ? { netWorth: { label: "Net Worth", color: NET_WORTH_COLOR } }
      : Object.fromEntries(
          decomposed.series.map((s) => [
            s.key,
            { label: s.label, color: s.color },
          ])
        );

  const toggleSeries = (key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      const visibleCount = decomposed.series.length - next.size;
      if (next.has(key)) {
        next.delete(key);
      } else if (visibleCount > 1) {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">
          Net Worth Over Time
        </CardTitle>
        <div className="flex gap-1 rounded-md border p-0.5 text-xs">
          {(
            [
              { value: "net-worth", label: "Net Worth" },
              { value: "category", label: "By Category" },
              { value: "account", label: "By Account" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleModeChange(opt.value)}
              className={`rounded px-2 py-1 transition-colors ${
                mode === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <ChartContainer config={chartConfig} className="min-h-0 flex-1 w-full">
          <LineChart
            data={mode === "net-worth" ? timeSeries : decomposed.rows}
            margin={{ left: 8, right: 8 }}
          >
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
                    const d = new Date(
                      payload[0].payload.date + "T00:00:00"
                    );
                    return format(d, "MMM d, yyyy");
                  }}
                  formatter={(value, name) => {
                    if (mode === "net-worth") {
                      return formatCurrencyFull(value as number);
                    }
                    return (
                      <div className="flex flex-1 justify-between gap-4">
                        <span className="font-bold">
                          {chartConfig[name as string]?.label ?? name}:
                        </span>
                        <span className="tabular-nums">
                          {formatCurrencyFull(value as number)}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            {mode === "net-worth" ? (
              <Line
                type="monotone"
                dataKey="netWorth"
                stroke={NET_WORTH_COLOR}
                strokeWidth={2}
                dot={false}
              />
            ) : (
              decomposed.series.map(
                (s) =>
                  !hiddenSeries.has(s.key) && (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                    />
                  )
              )
            )}
          </LineChart>
        </ChartContainer>
        {/* Clickable legend for decomposition modes */}
        {mode !== "net-worth" && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3 text-xs">
            {decomposed.series.map((s) => {
              const active = !hiddenSeries.has(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSeries(s.key)}
                  className={`flex items-center gap-1.5 transition-opacity ${
                    active ? "opacity-100" : "opacity-40 line-through"
                  }`}
                >
                  <div
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
