import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function AccountsReconciliationPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Reconciliation"
        subnav={<DrilldownTabs section="accounts" />}
      />
      <ComingSoon feature="Reconciliation drilldown" />
    </div>
  );
}
