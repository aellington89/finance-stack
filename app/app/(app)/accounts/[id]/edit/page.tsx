import { notFound } from "next/navigation";
import { getAccountById, getAccountTypes } from "@/lib/queries/accounts";
import { parseEntityId } from "@/lib/validations/id";
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

  // Not just a tidy-up of `Number(id)` (Issue #179): that guard passed "1.5"
  // and "Infinity" through to getAccountById(), where they bind to an integer
  // column and raise 22P02 — an error boundary where this should be a 404.
  const accountId = parseEntityId(id);
  if (accountId === null) notFound();

  const [account, accountTypes] = await Promise.all([
    getAccountById(accountId),
    getAccountTypes(),
  ]);

  if (!account) notFound();

  return (
    <div className="p-6 max-w-2xl mx-auto">
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
    </div>
  );
}
