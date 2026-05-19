import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function AccountsActivityPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Activity"
        subnav={<DrilldownTabs section="accounts" />}
      />
      <ComingSoon feature="Activity drilldown" />
    </div>
  );
}
