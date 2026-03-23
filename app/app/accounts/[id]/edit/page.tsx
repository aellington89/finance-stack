import { notFound } from "next/navigation";
import { getAccountById, getAccountTypes } from "@/lib/queries/accounts";
import { AccountForm } from "@/components/accounts/account-form";
import { DeleteAccountDialog } from "@/components/accounts/delete-account-dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accountId = Number(id);
  if (!accountId || accountId <= 0) notFound();

  const [account, accountTypes] = await Promise.all([
    getAccountById(accountId),
    getAccountTypes(),
  ]);

  if (!account) notFound();

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Edit Account</CardTitle>
          <DeleteAccountDialog
            accountId={account.accountId}
            accountName={account.accountName}
          />
        </CardHeader>
        <CardContent>
          <AccountForm accountTypes={accountTypes} account={account} />
        </CardContent>
      </Card>
    </main>
  );
}
