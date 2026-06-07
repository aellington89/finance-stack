import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  getCurrentNetWorth,
  getNetWorthTimeSeries,
} from "@/lib/queries/dashboard";
import { TimeSeriesChart } from "@/components/charts/net-worth-chart";
import { GaugeBadge } from "@/components/charts/gauge-badge";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { DashboardDateRangeFilter } from "@/components/dashboard/date-range-filter";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DateRangeError } from "@/components/dashboard/date-range-error";
import { getDateRangeFromParams } from "@/lib/queries/date-range";
import { validateDateRange } from "@/lib/validations/date-range";
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

  const validation = validateDateRange(params);
  if (!validation.ok) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Summary"
          subnav={<DrilldownTabs section="summary" />}
          filters={<DashboardDateRangeFilter />}
        />
        <DateRangeError message={validation.error} />
      </div>
    );
  }

  const { dateFrom, dateTo } = getDateRangeFromParams(params);

  const [currentNetWorth, timeSeries] = await Promise.all([
    getCurrentNetWorth(),
    getNetWorthTimeSeries(dateFrom, dateTo),
  ]);

  // Page-level date filter drives the whole page: the headline snapshot is
  // taken as of the latest balance within the selected range. With the default
  // range (no end date) the last point is today, matching the live snapshot.
  const lastPoint = timeSeries.at(-1);
  const summary = lastPoint ?? currentNetWorth;
  const asOfLabel = lastPoint
    ? new Date(lastPoint.date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Current snapshot";

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
      <DashboardPageHeader
        title="Summary"
        subnav={<DrilldownTabs section="summary" />}
        filters={<DashboardDateRangeFilter />}
      />

      {/* ── Section 1: Key Performance Metrics ── */}
      <Card>
        <CardHeader>
          <CardTitle>Key Performance Metrics</CardTitle>
          <CardDescription>As of {asOfLabel}</CardDescription>
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
        <CardHeader>
          <CardTitle>Historical Trends</CardTitle>
          <CardDescription>Balance over time</CardDescription>
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
