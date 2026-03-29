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
  createTransactionType,
  updateTransactionType,
  deleteTransactionType,
  createAccountType,
  updateAccountType,
  deleteAccountType,
} from "@/lib/actions/categories";
import { EntityCard } from "@/components/settings/entity-card";
import { AccountTypesCard } from "@/components/settings/account-types-card";

export const dynamic = "force-dynamic";

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
  }));

  const txnTypeItems = txnTypes.map((r) => ({
    id: r.transactionTypeId,
    name: r.transactionType,
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
        <EntityCard
          title="Transaction Types"
          entityLabel="Type"
          idFieldName="transactionTypeId"
          items={txnTypeItems}
          createAction={createTransactionType}
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
