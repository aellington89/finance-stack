import {
  getCurrentNetWorth,
  getNetWorthTimeSeries,
} from "@/lib/queries/dashboard";
import {
  getNetWorthWaterfall,
  getNetWorthDrivers,
  getNetWorthTrendDecomposition,
} from "@/lib/queries/net-worth-drilldown";
import { NetWorthTimeSeriesChart } from "@/components/charts/net-worth-timeseries-chart";
import { WaterfallChart } from "@/components/charts/waterfall-chart";
import { NetWorthDriversTable } from "@/components/dashboard/net-worth-drivers-table";
import { SummaryDrilldownTabs } from "@/components/dashboard/summary-drilldown-tabs";
import { DashboardDateRangeFilter } from "@/components/dashboard/date-range-filter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

export default async function NetWorthDrilldownPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Default to last 30 days when no date range is specified
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const defaultFromStr = defaultFrom.toISOString().slice(0, 10);

  const dateFrom =
    (Array.isArray(params.dateFrom) ? params.dateFrom[0] : params.dateFrom) ||
    defaultFromStr;
  const dateTo =
    (Array.isArray(params.dateTo) ? params.dateTo[0] : params.dateTo) ||
    undefined;

  const [summary, timeSeries, waterfall, drivers, decomposition] =
    await Promise.all([
      getCurrentNetWorth(),
      getNetWorthTimeSeries(dateFrom, dateTo),
      getNetWorthWaterfall(dateFrom, dateTo),
      getNetWorthDrivers(dateFrom, dateTo),
      getNetWorthTrendDecomposition(dateFrom, dateTo),
    ]);

  return (
    <div className="space-y-6">
      {/* ── Sub-navigation + Header ── */}
      <div>
        <SummaryDrilldownTabs />
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            Net Worth Analysis
          </h1>
          <DashboardDateRangeFilter basePath="/dashboard/net-worth" />
        </div>
      </div>

      {/* ── Net Worth Headline ── */}
      <Card>
        <CardHeader>
          <CardTitle>Current Net Worth</CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-5xl font-bold tabular-nums tracking-tight">
            {formatCurrency(summary.netWorth)}
          </span>
        </CardContent>
      </Card>

      {/* ── Main grid: Chart (left, spans 2 rows) + Waterfall & Drivers (right) ── */}
      <div className="grid gap-6 lg:grid-cols-2 lg:grid-rows-[auto_auto]">
        <div className="lg:row-span-2">
          <NetWorthTimeSeriesChart
            timeSeries={timeSeries}
            decomposition={decomposition}
          />
        </div>
        <WaterfallChart data={waterfall} />
        <NetWorthDriversTable data={drivers} />
      </div>
    </div>
  );
}
