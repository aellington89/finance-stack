import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function AccountingBudgetPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Budget"
        subnav={<DrilldownTabs section="accounting" />}
      />
      <ComingSoon feature="Budget drilldown" />
    </div>
  );
}
