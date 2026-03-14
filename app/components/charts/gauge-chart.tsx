"use client";

import { RadialBar, RadialBarChart, PolarAngleAxis } from "recharts";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface GaugeChartProps {
  title: string;
  /** Raw ratio value (e.g. 0.52, 1.52, 34.03) */
  value: number;
  /** Pre-formatted label shown in the center (e.g. "$1.52", "34.03%") */
  label: string;
  /** Maximum value for the gauge scale. Defaults to 100. */
  max?: number;
  color?: string;
}

export function GaugeChart({
  title,
  value,
  label,
  max = 100,
  color = "hsl(var(--chart-1))",
}: GaugeChartProps) {
  const chartConfig: ChartConfig = {
    value: {
      label: title,
      color,
    },
  };

  // Scale value into 0–100 range for the radial bar, clamped
  const scaled = Math.max(0, Math.min(100, (value / max) * 100));
  const data = [{ value: scaled, fill: color }];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center">
        <ChartContainer config={chartConfig} className="aspect-square w-full max-w-[200px]">
          <RadialBarChart
            data={data}
            startAngle={90}
            endAngle={-270}
            innerRadius="70%"
            outerRadius="100%"
          >
            <PolarAngleAxis
              type="number"
              domain={[0, 100]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              dataKey="value"
              cornerRadius={6}
              background={{ fill: "hsl(var(--muted))" }}
            />
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground text-2xl font-bold"
            >
              {label}
            </text>
          </RadialBarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
