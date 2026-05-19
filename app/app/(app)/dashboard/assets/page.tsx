import {
  getAssetAllocation,
  getAssetPerformance,
  getLiquidityBreakdown,
  getAssetTrendDecomposition,
} from "@/lib/queries/assets-drilldown";
import { AssetAllocationChart } from "@/components/charts/asset-allocation-chart";
import { AssetsTimeSeriesChart } from "@/components/charts/assets-timeseries-chart";
import { AssetPerformanceTable } from "@/components/dashboard/asset-performance-table";
import { LiquidityBreakdown } from "@/components/dashboard/liquidity-breakdown";
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

export const dynamic = "force-dynamic";

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

export default async function AssetsDrilldownPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { dateFrom, dateTo } = getDateRangeFromParams(params);

  const [allocation, performance, liquidity, decomposition] = await Promise.all(
    [
      getAssetAllocation(dateTo),
      getAssetPerformance(dateFrom, dateTo),
      getLiquidityBreakdown(dateTo),
      getAssetTrendDecomposition(dateFrom, dateTo),
    ]
  );

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Assets"
        subnav={<DrilldownTabs section="summary" />}
        filters={<DashboardDateRangeFilter basePath="/dashboard/assets" />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Total Assets</CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-5xl font-bold tabular-nums tracking-tight">
            {formatCurrency(allocation.totalAssets)}
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[500px]">
          <AssetAllocationChart data={allocation} />
        </div>
        <div className="h-[500px]">
          <AssetsTimeSeriesChart decomposition={decomposition} />
        </div>
      </div>

      <LiquidityBreakdown data={liquidity} />

      <AssetPerformanceTable data={performance} />
    </div>
  );
}
