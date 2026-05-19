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
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { DashboardDateRangeFilter } from "@/components/dashboard/date-range-filter";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { getDateRangeFromParams } from "@/lib/queries/date-range";
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
  const { dateFrom, dateTo } = getDateRangeFromParams(params);

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
      <DashboardPageHeader
        title="Liabilities"
        subnav={<DrilldownTabs section="summary" />}
        filters={<DashboardDateRangeFilter basePath="/dashboard/liabilities" />}
      />

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
