import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function AccountingInvestmentsPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Investments"
        subnav={<DrilldownTabs section="accounting" />}
      />
      <ComingSoon feature="Investments drilldown" />
    </div>
  );
}
