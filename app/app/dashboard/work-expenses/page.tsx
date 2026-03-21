import {
  getWorkExpenseTotals,
  getWorkExpenseTimeSeries,
  getWorkExpenseCategoryBreakdown,
} from "@/lib/queries/work-expenses";
import { AccountingKpiCard } from "@/components/dashboard/accounting-kpi-card";
import { DashboardDateRangeFilter } from "@/components/dashboard/date-range-filter";
import { WorkExpensesChart } from "@/components/charts/work-expenses-chart";
import { ExpensesCategoryChart } from "@/components/charts/expenses-category-chart";

export const dynamic = "force-dynamic";

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

export default async function WorkExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;

  const get = (key: string): string | undefined => {
    const val = resolvedParams[key];
    if (Array.isArray(val)) return val[0];
    return val || undefined;
  };

  // Default to last 30 days
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const dateFrom = get("dateFrom") || defaultFrom.toISOString().slice(0, 10);
  const dateTo = get("dateTo") || undefined;

  const filters = { dateFrom, dateTo };

  const [totals, timeSeries, categoryBreakdown] = await Promise.all([
    getWorkExpenseTotals(filters),
    getWorkExpenseTimeSeries(filters),
    getWorkExpenseCategoryBreakdown(filters),
  ]);

  const netUnreimbursed = totals.totalWorkExpenses - totals.totalReimbursements;
  const reimbursementRate = totals.totalWorkExpenses > 0
    ? (totals.totalReimbursements / totals.totalWorkExpenses) * 100
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Work Expenses</h1>
        <div className="mt-3">
          <DashboardDateRangeFilter basePath="/dashboard/work-expenses" />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <AccountingKpiCard
          title="Total Work Expenses"
          value={formatCurrency(totals.totalWorkExpenses)}
        />
        <AccountingKpiCard
          title="Total Work Expense Reimbursement"
          value={formatCurrency(totals.totalReimbursements)}
        />
        <AccountingKpiCard
          title="Net Unreimbursed"
          value={formatCurrency(netUnreimbursed)}
        />
        <AccountingKpiCard
          title="Reimbursement Rate"
          value={`${reimbursementRate.toFixed(1)}%`}
          positiveDirection="up"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <WorkExpensesChart data={timeSeries} />
        <ExpensesCategoryChart data={categoryBreakdown} title="Work Expenses by Category" />
      </div>
    </div>
  );
}
