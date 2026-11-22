import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { RecurringTransactionsCard } from "@/components/transactions/recurring-transactions-card";
import { getRecurringTransactions } from "@/lib/queries/recurring-transactions";
import { getTransactionFormOptions } from "@/lib/queries/transactions";
import { currentDate } from "@/lib/recurring/materialize";
import {
  createRecurringTransaction,
  deleteRecurringTransaction,
  updateRecurringTransaction,
} from "@/lib/actions/recurring-transaction";

// Explicit, though the dashboard layout already forces it: this page reads
// templates the scheduler advances outside any request, so nothing of it may
// ever be cached (Issue #135).
export const dynamic = "force-dynamic";

export default async function TransactionsRecurringPage() {
  // Postgres's date, the "today" a save counts from, so the dialog's preview
  // agrees with the save's "N transactions added".
  const [templates, { accounts, types, categories }, today] = await Promise.all([
    getRecurringTransactions(),
    getTransactionFormOptions(),
    currentDate(),
  ]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Recurring"
        subnav={<DrilldownTabs section="transactions" />}
      />
      <RecurringTransactionsCard
        templates={templates}
        accounts={accounts}
        types={types}
        categories={categories}
        today={today}
        createAction={createRecurringTransaction}
        updateAction={updateRecurringTransaction}
        deleteAction={deleteRecurringTransaction}
      />
    </div>
  );
}
