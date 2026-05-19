import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function AccountingIncomePage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Income"
        subnav={<DrilldownTabs section="accounting" />}
      />
      <ComingSoon feature="Income drilldown" />
    </div>
  );
}
