import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function TransactionsMerchantsPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Merchants"
        subnav={<DrilldownTabs section="transactions" />}
      />
      <ComingSoon feature="Merchants drilldown" />
    </div>
  );
}
