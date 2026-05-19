import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function AccountingExpensesPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Expenses"
        subnav={<DrilldownTabs section="accounting" />}
      />
      <ComingSoon feature="Expenses drilldown" />
    </div>
  );
}
