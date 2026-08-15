import { notFound } from "next/navigation";

import {
  getAccountTypeCategories,
  getTransactionTypes,
} from "@/lib/queries/categories";
import {
  createAccountTypeCategory,
  updateAccountTypeCategory,
  deleteAccountTypeCategory,
  createTransactionType,
  updateTransactionType,
  deleteTransactionType,
} from "@/lib/actions/categories";
import {
  protectionFor,
  PROTECTION_TOOLTIP,
  type ProtectedTable,
} from "@/lib/constants/protected-rows";
import { currentUserRole } from "@/lib/auth/guard";
import { isAdminRole } from "@/lib/auth/roles";
import { EntityCard } from "@/components/settings/entity-card";

export const dynamic = "force-dynamic";

// The two lookup tables a regular user must not touch (Issue #87).
//
// `account_type_categories` and `transaction_types` are the basis of the
// balance-sheet groupings and the transaction classification every KPI reads,
// so a wrong edit here is not one bad row — it is every dashboard at once.
// `/settings/categories` deliberately stays open to any signed-in user: naming
// your own transaction categories and account types is ordinary use, and since
// Issue #111 it is also where you tag a category with a reporting role.
//
// Three layers, matching the model in docs/auth.md. The proxy is not one of
// them: it answers a denied request with a 302 to /login, which is the wrong
// answer for a signed-in non-admin (the same reasoning that kept
// /api/health/seed-data out of its matcher).
//
//   1. The sidebar omits the link — UX, not enforcement.
//   2. This page notFound()s a non-admin. notFound() rather than a redirect
//      because an admin route should not announce itself to someone who may
//      not have one.
//   3. Every action below re-checks, because server actions are directly
//      POST-able regardless of which page renders them. That is the boundary.
//
// The role comes from currentUserRole(), which reads the database rather than
// the session token — sessions are 30-day JWTs with no server-side revocation,
// so a demoted admin's cookie would otherwise stay authoritative for a month.

function lockedReason(table: ProtectedTable, id: number): string | null {
  const protection = protectionFor(table, id);
  return protection ? PROTECTION_TOOLTIP[protection.reason] : null;
}

export default async function AdminSettingsPage() {
  if (!isAdminRole(await currentUserRole())) notFound();

  const [acctTypeCategories, txnTypes] = await Promise.all([
    getAccountTypeCategories(),
    getTransactionTypes(),
  ]);

  const acctTypeCategoryItems = acctTypeCategories.map((r) => ({
    id: r.accountTypeCategoryId,
    name: r.accountTypeCategory,
    lockedReason: lockedReason("account_type_categories", r.accountTypeCategoryId),
  }));

  const txnTypeItems = txnTypes.map((r) => ({
    id: r.transactionTypeId,
    name: r.transactionType,
    lockedReason: lockedReason("transaction_types", r.transactionTypeId),
  }));

  return (
    <div className="p-6 w-3/4 mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reference tables the dashboard, accounting and work-expense views compute
          from. Every row that ships with the app is locked; the rest are editable
          here and nowhere else.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-6 items-start">
        <EntityCard
          title="Account Type Categories"
          entityLabel="Category"
          idFieldName="accountTypeCategoryId"
          items={acctTypeCategoryItems}
          createAction={createAccountTypeCategory}
          updateAction={updateAccountTypeCategory}
          deleteAction={deleteAccountTypeCategory}
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
      </div>
    </div>
  );
}
