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

export default async function AssetsDrilldownPage({
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
      <div>
        <SummaryDrilldownTabs />
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Asset Analysis</h1>
          <DashboardDateRangeFilter basePath="/dashboard/assets" />
        </div>
      </div>

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
