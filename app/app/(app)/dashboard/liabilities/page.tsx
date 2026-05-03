import {
  getDebtServiceSummary,
  getDebtWaterfall,
  getLiabilityAllocation,
  getLiabilityPerformance,
  getLiabilityTrendDecomposition,
} from "@/lib/queries/liabilities-drilldown";
import { LiabilityAllocationChart } from "@/components/charts/liability-allocation-chart";
import { LiabilitiesTimeSeriesChart } from "@/components/charts/liabilities-timeseries-chart";
import { DebtWaterfallChart } from "@/components/charts/debt-waterfall-chart";
import { DebtMixBreakdown } from "@/components/dashboard/debt-mix-breakdown";
import { DebtServiceSummary } from "@/components/dashboard/debt-service-summary";
import { LiabilityPerformanceTable } from "@/components/dashboard/liability-performance-table";
import { SummaryDrilldownTabs } from "@/components/dashboard/summary-drilldown-tabs";
import { DashboardDateRangeFilter } from "@/components/dashboard/date-range-filter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { changeColor, signedCurrency } from "@/lib/format/financial";

export const dynamic = "force-dynamic";

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

export default async function LiabilitiesDrilldownPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const defaultFromStr = defaultFrom.toISOString().slice(0, 10);

  const dateFrom =
    (Array.isArray(params.dateFrom) ? params.dateFrom[0] : params.dateFrom) ||
    defaultFromStr;
  const dateTo =
    (Array.isArray(params.dateTo) ? params.dateTo[0] : params.dateTo) ||
    undefined;

  const [allocation, performance, decomposition, debtService, waterfall] =
    await Promise.all([
      getLiabilityAllocation(dateTo),
      getLiabilityPerformance(dateFrom, dateTo),
      getLiabilityTrendDecomposition(dateFrom, dateTo),
      getDebtServiceSummary(dateFrom, dateTo),
      getDebtWaterfall(dateFrom, dateTo),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <SummaryDrilldownTabs />
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            Liability Analysis
          </h1>
          <DashboardDateRangeFilter basePath="/dashboard/liabilities" />
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Liabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-5xl font-bold tabular-nums tracking-tight">
              {formatCurrency(allocation.totalLiabilities)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Current Liabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-5xl font-bold tabular-nums tracking-tight">
              {formatCurrency(allocation.currentLiabilities)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Long-term Liabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-5xl font-bold tabular-nums tracking-tight">
              {formatCurrency(allocation.nonCurrentLiabilities)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Period Change</CardTitle>
          </CardHeader>
          <CardContent>
            <span
              className={`text-5xl font-bold tabular-nums tracking-tight ${changeColor(performance.totalChange)}`}
            >
              {signedCurrency(performance.totalChange)}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[500px]">
          <LiabilityAllocationChart data={allocation} />
        </div>
        <div className="h-[500px]">
          <LiabilitiesTimeSeriesChart decomposition={decomposition} />
        </div>
      </div>

      <DebtMixBreakdown data={allocation} />

      <div className="h-[400px]">
        <DebtWaterfallChart data={waterfall} />
      </div>

      <DebtServiceSummary data={debtService} />

      <LiabilityPerformanceTable data={performance} />
    </div>
  );
}
