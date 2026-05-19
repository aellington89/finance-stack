import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function TransactionsCategoriesPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Categories"
        subnav={<DrilldownTabs section="transactions" />}
      />
      <ComingSoon feature="Categories drilldown" />
    </div>
  );
}
