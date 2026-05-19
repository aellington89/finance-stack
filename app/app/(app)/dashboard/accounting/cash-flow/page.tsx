import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function AccountingCashFlowPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Cash Flow"
        subnav={<DrilldownTabs section="accounting" />}
      />
      <ComingSoon feature="Cash Flow drilldown" />
    </div>
  );
}
