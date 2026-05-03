"use client";

import { useMemo } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { LiabilityAllocationData } from "@/lib/queries/liabilities-drilldown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Stable per-category palette. Categories themselves are stable lookups
// (5 = Current Liability, 6 = Non-current Liability) so hard-coding keys
// is safe — but account types under each category are dynamic and assigned
// shaded variants in `shadeForType`.
const CATEGORY_COLORS: Record<number, string> = {
  5: "#e23670", // Current Liability — pink
  6: "#c2185b", // Non-current Liability — darker pink
};

const TYPE_SHADES = ["#e23670", "#d6336c", "#c2185b", "#a01457", "#7c1054"];

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

interface TreemapNode {
  name: string;
  size?: number;
  rawValue?: number;
  categoryId?: number;
  categoryName?: string;
  accountTypeId?: number;
  percentOfTotal?: number;
  percentOfParent?: number;
  children?: TreemapNode[];
}

interface LiabilityAllocationChartProps {
  data: LiabilityAllocationData;
}

interface ContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  size?: number;
  rawValue?: number;
  categoryId?: number;
  accountTypeId?: number;
  percentOfTotal?: number;
  depth?: number;
}

function TreemapContent(props: ContentProps) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    depth,
    name,
    rawValue,
    categoryId,
    accountTypeId,
    percentOfTotal,
  } = props;

  if (depth !== 2) return <g />;

  const baseColor = categoryId ? CATEGORY_COLORS[categoryId] ?? "#6b7280" : "#6b7280";
  // Use the type id to pick a stable shade within the category palette.
  const shade =
    accountTypeId != null
      ? TYPE_SHADES[accountTypeId % TYPE_SHADES.length]
      : baseColor;

  const canLabel = width > 70 && height > 32;
  const canDetails = width > 90 && height > 52;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: shade,
          stroke: "#fff",
          strokeWidth: 2,
          strokeOpacity: 0.8,
        }}
      />
      {canLabel && (
        <text x={x + 6} y={y + 16} fill="#fff" fontSize={11} fontWeight={600}>
          {name}
        </text>
      )}
      {canDetails && rawValue != null && (
        <text x={x + 6} y={y + 32} fill="#fff" fontSize={10} opacity={0.85}>
          {formatCurrencyCompact(rawValue)}
          {percentOfTotal != null ? ` · ${percentOfTotal.toFixed(1)}%` : ""}
        </text>
      )}
    </g>
  );
}

interface TreemapTooltipPayload {
  name?: string;
  size?: number;
  rawValue?: number;
  categoryName?: string;
  percentOfTotal?: number;
  percentOfParent?: number;
}

function TreemapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: TreemapTooltipPayload }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  if (!datum || datum.rawValue == null) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{datum.name}</div>
      {datum.categoryName && (
        <div className="text-muted-foreground">{datum.categoryName}</div>
      )}
      <div className="mt-1 tabular-nums">
        {formatCurrencyFull(datum.rawValue)}
      </div>
      {datum.percentOfTotal != null && (
        <div className="text-muted-foreground tabular-nums">
          {datum.percentOfTotal.toFixed(2)}% of total
        </div>
      )}
    </div>
  );
}

export function LiabilityAllocationChart({
  data,
}: LiabilityAllocationChartProps) {
  // Treemap tile size must be a positive number, but liability balances are
  // negative. Use the absolute value for `size` (controls tile area) and
  // surface the raw signed value separately for labels and tooltips.
  const treeData: TreemapNode[] = useMemo(() => {
    return data.byCategory.map((cat) => ({
      name: cat.categoryName,
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      children: cat.children.map((child) => ({
        name: child.accountTypeName,
        size: Math.abs(child.value),
        rawValue: child.value,
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        accountTypeId: child.accountTypeId,
        percentOfTotal: child.percentOfTotal,
        percentOfParent: child.percentOfParent,
      })),
    }));
  }, [data]);

  const isEmpty =
    data.byCategory.length === 0 || data.totalLiabilities === 0;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Liability Allocation
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1">
          {isEmpty ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No liability balances in the selected range.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={treeData}
                dataKey="size"
                nameKey="name"
                stroke="#fff"
                isAnimationActive={false}
                content={<TreemapContent />}
              >
                <Tooltip content={<TreemapTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
          {data.byCategory.map((cat) => (
            <div key={cat.categoryId} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: CATEGORY_COLORS[cat.categoryId] ?? "#6b7280",
                }}
                aria-hidden
              />
              <span>
                {cat.categoryName} · {cat.percentOfTotal.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
