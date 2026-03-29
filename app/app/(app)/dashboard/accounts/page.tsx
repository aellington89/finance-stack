import { getAccountBalances } from "@/lib/queries/accounts";
import { AccountsTable } from "@/components/accounts/accounts-table";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const balances = await getAccountBalances();

  return <AccountsTable data={balances} />;
}
