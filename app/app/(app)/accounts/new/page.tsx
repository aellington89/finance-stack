import { getAccountTypes } from "@/lib/queries/accounts";
import { AccountForm } from "@/components/accounts/account-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string }>;
}) {
  const { typeId } = await searchParams;
  const accountTypes = await getAccountTypes();
  const defaultTypeId = typeId ? Number(typeId) : undefined;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>New Account</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm
            accountTypes={accountTypes}
            defaultTypeId={defaultTypeId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
