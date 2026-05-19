import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function WorkExpensesReimbursementsPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Reimbursements"
        subnav={<DrilldownTabs section="work-expenses" />}
      />
      <ComingSoon feature="Reimbursements drilldown" />
    </div>
  );
}
