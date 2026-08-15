import {
  getTransactionCategories,
  getAccountTypeCategories,
  getAccountTypes,
} from "@/lib/queries/categories";
import {
  createTransactionCategory,
  updateTransactionCategory,
  deleteTransactionCategory,
  createAccountType,
  updateAccountType,
  deleteAccountType,
} from "@/lib/actions/categories";
import {
  protectionFor,
  PROTECTION_TOOLTIP,
  type ProtectedTable,
} from "@/lib/constants/protected-rows";
import { REPORTING_ROLES, reportingRole } from "@/lib/constants/reporting-roles";
import { EntityCard } from "@/components/settings/entity-card";
import { AccountTypesCard } from "@/components/settings/account-types-card";

export const dynamic = "force-dynamic";

// The server actions refuse a protected row whatever the UI does (Issue #109).
// This resolves the same predicate for display so the page does not offer an
// edit that is going to bounce.
function lockedReason(table: ProtectedTable, id: number): string | null {
  const protection = protectionFor(table, id);
  return protection ? PROTECTION_TOOLTIP[protection.reason] : null;
}

// The picker's options, straight off the registry (Issue #111) — adding a role
// there is what puts it here.
const ROLE_OPTIONS = REPORTING_ROLES.map((role) => ({
  key: role.key,
  label: role.label,
  description: role.description,
}));

// A role stored in the database that this build no longer declares resolves to
// null rather than throwing, so a downgrade shows the category as untagged
// instead of breaking the page.
function roleBadge(key: string | null) {
  const role = reportingRole(key);
  return role ? { key: role.key, label: role.label } : null;
}

// Transaction Types is deliberately absent from this page (Issue #87).
//
// It rendered a list of twelve padlocks: every row the table ships is protected
// against rename and delete, and #109 removed the Add button, so on a clean
// install the card offered no action at all. The only rows it could still act on
// were ones an install created past id 12 before that — and those are exactly
// what a regular user must not edit, since transaction_types drives the
// classification every KPI reads. The whole table now lives on /settings/admin,
// where the create affordance already had to be.
export default async function CategoriesPage() {
  const [txnCategories, acctTypeCategories, acctTypes] = await Promise.all([
    getTransactionCategories(),
    getAccountTypeCategories(),
    getAccountTypes(),
  ]);

  const txnCategoryItems = txnCategories.map((r) => ({
    id: r.transactionCategoryId,
    name: r.transactionCategory,
    lockedReason: lockedReason("transaction_categories", r.transactionCategoryId),
    role: roleBadge(r.reportingRole),
  }));

  const acctTypeCategoryItems = acctTypeCategories.map((r) => ({
    id: r.accountTypeCategoryId,
    name: r.accountTypeCategory,
  }));

  return (
    <div className="p-6 w-3/4 mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Categories &amp; Account Types</h1>
      </div>
      <div className="grid grid-cols-2 gap-6 items-start">
        <EntityCard
          title="Transaction Categories"
          entityLabel="Category"
          idFieldName="transactionCategoryId"
          items={txnCategoryItems}
          createAction={createTransactionCategory}
          updateAction={updateTransactionCategory}
          deleteAction={deleteTransactionCategory}
          roleOptions={ROLE_OPTIONS}
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
