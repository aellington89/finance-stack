import {
  getTransactionCategories,
  getTransactionTypes,
  getAccountTypeCategories,
  getAccountTypes,
} from "@/lib/queries/categories";
import {
  createTransactionCategory,
  updateTransactionCategory,
  deleteTransactionCategory,
  updateTransactionType,
  deleteTransactionType,
  createAccountType,
  updateAccountType,
  deleteAccountType,
} from "@/lib/actions/categories";
import {
  protectionFor,
  PROTECTION_TOOLTIP,
  type ProtectedTable,
} from "@/lib/constants/protected-rows";
import { EntityCard } from "@/components/settings/entity-card";
import { AccountTypesCard } from "@/components/settings/account-types-card";

export const dynamic = "force-dynamic";

// The server actions refuse a protected row whatever the UI does (Issue #109).
// This resolves the same predicate for display so the page does not offer an
// edit that is going to bounce.
function lockedReason(table: ProtectedTable, id: number, name: string): string | null {
  const protection = protectionFor(table, id, name);
  return protection ? PROTECTION_TOOLTIP[protection.reason] : null;
}

export default async function CategoriesPage() {
  const [txnCategories, txnTypes, acctTypeCategories, acctTypes] =
    await Promise.all([
      getTransactionCategories(),
      getTransactionTypes(),
      getAccountTypeCategories(),
      getAccountTypes(),
    ]);

  const txnCategoryItems = txnCategories.map((r) => ({
    id: r.transactionCategoryId,
    name: r.transactionCategory,
    lockedReason: lockedReason(
      "transaction_categories",
      r.transactionCategoryId,
      r.transactionCategory
    ),
  }));

  const txnTypeItems = txnTypes.map((r) => ({
    id: r.transactionTypeId,
    name: r.transactionType,
    lockedReason: lockedReason("transaction_types", r.transactionTypeId, r.transactionType),
  }));

  const acctTypeCategoryItems = acctTypeCategories.map((r) => ({
    id: r.accountTypeCategoryId,
    name: r.accountTypeCategory,
  }));

  return (
    <div className="p-6 w-3/4 mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Categories &amp; Types</h1>
      </div>
      <div className="grid grid-cols-3 gap-6 items-start">
        <EntityCard
          title="Transaction Categories"
          entityLabel="Category"
          idFieldName="transactionCategoryId"
          items={txnCategoryItems}
          createAction={createTransactionCategory}
          updateAction={updateTransactionCategory}
          deleteAction={deleteTransactionCategory}
        />
        {/* No createAction: the full set ships with the app (Issue #109). */}
        <EntityCard
          title="Transaction Types"
          entityLabel="Type"
          idFieldName="transactionTypeId"
          items={txnTypeItems}
          updateAction={updateTransactionType}
          deleteAction={deleteTransactionType}
        />
        <AccountTypesCard
          accountTypes={acctTypes}
          categoryOptions={acctTypeCategoryItems}
          createAction={createAccountType}
          updateAction={updateAccountType}
          deleteAction={deleteAccountType}
        />
      </div>
    </div>
  );
}
