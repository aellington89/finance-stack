import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  getCurrentNetWorth,
  getNetWorthTimeSeries,
} from "@/lib/queries/dashboard";
import { TimeSeriesChart } from "@/components/charts/net-worth-chart";
import { GaugeBadge } from "@/components/charts/gauge-badge";
import { SummaryDrilldownTabs } from "@/components/dashboard/summary-drilldown-tabs";
import { DashboardDateRangeFilter } from "@/components/dashboard/date-range-filter";
import { getDateRangeFromParams } from "@/lib/queries/date-range";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Hardcoded hex colors — SVG presentation attributes can't resolve CSS vars.
const COLORS = {
  netWorth: "#2eb88a",
  assets: "#2662d9",
  liabilities: "#e23670",
};

// Gauge color ranges (red → yellow → green → blue)
const RANGE_COLORS = {
  red: "#e23670",
  yellow: "#eab308",
  green: "#2eb88a",
  blue: "#2662d9",
};

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

export default async function DashboardSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { dateFrom, dateTo } = getDateRangeFromParams(params);

  const [summary, timeSeries] = await Promise.all([
    getCurrentNetWorth(),
    getNetWorthTimeSeries(dateFrom, dateTo),
  ]);

  // KPI ratios — rounded to nearest hundredth
  const absLiabilities = Math.abs(summary.totalLiabilities);
  const assetToLiability =
    absLiabilities > 0
      ? Math.round((summary.totalAssets / absLiabilities) * 100) / 100
      : 0;
  const nwToAsset =
    summary.totalAssets > 0
      ? Math.round((summary.netWorth / summary.totalAssets) * 10000) / 100
      : 0;
  const nwToLiability =
    absLiabilities > 0
      ? Math.round((summary.netWorth / absLiabilities) * 100) / 100
      : 0;

  return (
    <div className="space-y-6">
      <SummaryDrilldownTabs />

      {/* ── Section 1: Key Performance Metrics ── */}
      <Card>
        <CardHeader>
          <CardTitle>Key Performance Metrics</CardTitle>
          <CardDescription>Current snapshot</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
            {/* Net Worth headline — links to drill-down */}
            <Link
              href="/dashboard/net-worth"
              className="group flex flex-col justify-center gap-1 shrink-0 lg:min-w-[280px] -mx-3 px-3 py-2 rounded-md transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                Net Worth
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="text-5xl font-bold tabular-nums tracking-tight">
                {formatCurrency(summary.netWorth)}
              </span>
            </Link>

            {/* Gauge badges row */}
            <div className="flex flex-1 items-center justify-evenly gap-4">
              <GaugeBadge
                title="Assets per $ of Debt"
                label={`$${assetToLiability.toFixed(2)}`}
                value={assetToLiability}
                min={0}
                max={3}
                segments={[
                  { max: 1, color: RANGE_COLORS.red },
                  { max: 1.5, color: RANGE_COLORS.yellow },
                  { max: 2, color: RANGE_COLORS.green },
                  { max: 3, color: RANGE_COLORS.blue },
                ]}
              />
              <GaugeBadge
                title="% Owned Assets"
                label={`${nwToAsset.toFixed(2)}%`}
                value={nwToAsset}
                min={-33}
                max={100}
                segments={[
                  { max: 0, color: RANGE_COLORS.red },
                  { max: 33, color: RANGE_COLORS.yellow },
                  { max: 66, color: RANGE_COLORS.green },
                  { max: 100, color: RANGE_COLORS.blue },
                ]}
              />
              <GaugeBadge
                title="Equity per $ of Debt"
                label={`$${nwToLiability.toFixed(2)}`}
                value={nwToLiability}
                min={-1}
                max={2}
                segments={[
                  { max: 0, color: RANGE_COLORS.red },
                  { max: 0.5, color: RANGE_COLORS.yellow },
                  { max: 1, color: RANGE_COLORS.green },
                  { max: 2, color: RANGE_COLORS.blue },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Historical Trends ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Historical Trends</CardTitle>
            <CardDescription>Balance over time</CardDescription>
          </div>
          <DashboardDateRangeFilter />
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <TimeSeriesChart
              title="Net Worth"
              data={timeSeries}
              dataKey="netWorth"
              color={COLORS.netWorth}
              href="/dashboard/net-worth"
            />
            <TimeSeriesChart
              title="Total Assets"
              data={timeSeries}
              dataKey="totalAssets"
              color={COLORS.assets}
              href="/dashboard/assets"
            />
            <TimeSeriesChart
              title="Total Liabilities"
              data={timeSeries}
              dataKey="totalLiabilities"
              color={COLORS.liabilities}
              href="/dashboard/liabilities"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
