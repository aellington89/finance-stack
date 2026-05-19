import { getAccountBalances } from "@/lib/queries/accounts";
import { AccountsTable } from "@/components/accounts/accounts-table";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const balances = await getAccountBalances();

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Accounts"
        subnav={<DrilldownTabs section="accounts" />}
      />
      <AccountsTable data={balances} />
    </div>
  );
}
