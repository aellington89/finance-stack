"use client";

import { useId, useMemo } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { AllocationData } from "@/lib/queries/assets-drilldown";
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

const CATEGORY_COLORS: Record<number, string> = {
  1: "#2eb88a", // Current Asset
  2: "#8b5cf6", // Restricted Asset
  3: "#eab308", // Fixed Asset
  4: "#2662d9", // Investment
};

// A type alias, not an interface: recharts 3 types `Treemap`'s `data` as
// `TreemapDataType[]`, which carries a `[key: string]: unknown` index
// signature. TypeScript gives object type aliases an implicit index signature
// but never gives one to an interface, so an interface here is unassignable.
type TreemapNode = {
  name: string;
  size?: number;
  categoryId?: number;
  categoryName?: string;
  percentOfTotal?: number;
  percentOfParent?: number;
  children?: TreemapNode[];
};

interface AssetAllocationChartProps {
  data: AllocationData;
}

interface ContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  size?: number;
  categoryId?: number;
  categoryName?: string;
  percentOfTotal?: number;
  depth?: number;
  root?: { children?: TreemapNode[] };
}

function TreemapContent(props: ContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, depth, name, size, categoryId, percentOfTotal } = props;

  // Depth 0 = virtual root; depth 1 = category (hidden, only used for grouping);
  // depth 2 = leaf (account type).
  if (depth !== 2) {
    return <g />;
  }

  const color = categoryId ? CATEGORY_COLORS[categoryId] ?? "#6b7280" : "#6b7280";
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
          fill: color,
          stroke: "#fff",
          strokeWidth: 2,
          strokeOpacity: 0.8,
        }}
      />
      {canLabel && (
        <text
          x={x + 6}
          y={y + 16}
          fill="#fff"
          fontSize={11}
          fontWeight={600}
        >
          {name}
        </text>
      )}
      {canDetails && size != null && (
        <text x={x + 6} y={y + 32} fill="#fff" fontSize={10} opacity={0.85}>
          {formatCurrencyCompact(size)}
          {percentOfTotal != null ? ` · ${percentOfTotal.toFixed(1)}%` : ""}
        </text>
      )}
    </g>
  );
}

interface TreemapTooltipPayload {
  name?: string;
  size?: number;
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
  if (!datum || datum.size == null) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{datum.name}</div>
      {datum.categoryName && (
        <div className="text-muted-foreground">{datum.categoryName}</div>
      )}
      <div className="mt-1 tabular-nums">
        {formatCurrency(datum.size)}
      </div>
      {datum.percentOfTotal != null && (
        <div className="text-muted-foreground tabular-nums">
          {datum.percentOfTotal.toFixed(2)}% of total
        </div>
      )}
    </div>
  );
}

// The visible card title is also the image's accessible name, so the two
// cannot drift; the description says what is plotted (Issue #144).
const TITLE = "Asset Allocation";
const DESCRIPTION =
  "Treemap of asset balances by account type, each tile sized by its balance and grouped by account category.";

export function AssetAllocationChart({ data }: AssetAllocationChartProps) {
  const descId = useId();
  const treeData: TreemapNode[] = useMemo(() => {
    return data.byCategory.map((cat) => ({
      name: cat.categoryName,
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      children: cat.children.map((child) => ({
        name: child.accountTypeName,
        size: child.value,
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        percentOfTotal: child.percentOfTotal,
        percentOfParent: child.percentOfParent,
      })),
    }));
  }, [data]);

  const isEmpty = data.byCategory.length === 0 || data.totalAssets === 0;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-sm font-medium">{TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1">
          {isEmpty ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No asset balances in the selected range.
            </div>
          ) : (
            // recharts' Treemap drops `title` and `desc`: neither is in the
            // SVG prop allowlist it filters its props through, and its types
            // do not declare them. So the name goes on a wrapper, the way the
            // liquidity and debt-mix bars are named. A treemap has no
            // accessibility layer, so nothing inside the image is focusable.
            // The description is `hidden` rather than sr-only so a screen
            // reader does not also read it as page text (Issue #144).
            <div
              role="img"
              aria-label={TITLE}
              aria-describedby={descId}
              className="h-full"
            >
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
              <p id={descId} hidden>
                {DESCRIPTION}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
          {data.byCategory.map((cat) => (
            <div key={cat.categoryId} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: CATEGORY_COLORS[cat.categoryId] ?? "#6b7280" }}
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
