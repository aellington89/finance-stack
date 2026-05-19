import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function TransactionsRecurringPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Recurring"
        subnav={<DrilldownTabs section="transactions" />}
      />
      <ComingSoon feature="Recurring drilldown" />
    </div>
  );
}
