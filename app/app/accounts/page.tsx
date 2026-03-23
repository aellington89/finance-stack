import Link from "next/link";
import { getAccountsList } from "@/lib/queries/accounts";
import { AccountsByCategory } from "@/components/accounts/accounts-by-category";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await getAccountsList();

  return (
    <main className="p-6 w-3/4 mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Accounts</h1>
      </div>
      {accounts.length === 0 ? (
        <p className="text-muted-foreground">
          No accounts yet.{" "}
          <Link href="/accounts/new" className="underline">
            Create one
          </Link>
          .
        </p>
      ) : (
        <AccountsByCategory accounts={accounts} />
      )}
    </main>
  );
}
