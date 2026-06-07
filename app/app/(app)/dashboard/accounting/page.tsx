import {
  getAccountingTimeSeries,
  getAccountingPeriodTotals,
  getAccountingToDateComparison,
  getExpenseCategoryBreakdown,
  getAccountingMonthlyAverages,
  isStandardGrouping,
  type AccountingFilters,
  type TimeGrouping,
} from "@/lib/queries/accounting";
import {
  getTransactionFormOptions,
  getUniqueDescriptions,
} from "@/lib/queries/transactions";
import { AccountingChart } from "@/components/charts/accounting-chart";
import { ExpensesCategoryChart } from "@/components/charts/expenses-category-chart";
import { AccountingKpiCard } from "@/components/dashboard/accounting-kpi-card";
import { AccountingFilters as AccountingFiltersUI } from "@/components/dashboard/accounting-filters";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { DateRangeError } from "@/components/dashboard/date-range-error";
import { getDateRangeFromParams } from "@/lib/queries/date-range";
import { validateDateRange } from "@/lib/validations/date-range";

export const dynamic = "force-dynamic";

const VALID_GROUPINGS: TimeGrouping[] = [
  "day", "week", "month", "quarter", "year",
  "day_of_week", "day_of_month", "day_of_year",
  "week_of_year", "month_of_year", "quarter_of_year",
];

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

function computeChange(
  current: number,
  previous: number,
  prevLabel: string
): {
  percent: number;
  direction: "up" | "down" | "none";
  label: string;
} {
  if (previous === 0 && current === 0) {
    return { percent: 0, direction: "none", label: `vs. ${prevLabel}` };
  }
  if (previous === 0) {
    return { percent: 100, direction: "up", label: `vs. ${prevLabel}: ${formatCurrency(previous)}` };
  }
  const pct = ((current - previous) / previous) * 100;
  if (pct === 0) {
    return { percent: 0, direction: "none", label: `vs. ${prevLabel}` };
  }
  return {
    percent: Math.abs(pct),
    direction: pct > 0 ? "up" : "down",
    label: `vs. ${prevLabel}: ${formatCurrency(previous)}`,
  };
}

function parseSearchParams(
  params: Record<string, string | string[] | undefined>
): AccountingFilters & { rawFilters: Record<string, string | string[] | number[] | undefined> } {
  const get = (key: string): string | undefined => {
    const val = params[key];
    if (Array.isArray(val)) return val[0];
    return val || undefined;
  };

  const getNumberArray = (key: string): number[] | undefined => {
    const raw = get(key);
    if (!raw) return undefined;
    const nums = raw.split(",").map(Number).filter((n) => !isNaN(n));
    return nums.length > 0 ? nums : undefined;
  };

  const getStringArray = (key: string): string[] | undefined => {
    const raw = get(key);
    if (!raw) return undefined;
    const items = raw.split(",").filter(Boolean);
    return items.length > 0 ? items : undefined;
  };

  const { dateFrom, dateTo } = getDateRangeFromParams(params);
  const descriptions = getStringArray("descriptions");
  const accountIds = getNumberArray("accountIds");
  const categoryIds = getNumberArray("categoryIds");
  const rawGrouping = get("timeGrouping");
  const timeGrouping: TimeGrouping = VALID_GROUPINGS.includes(rawGrouping as TimeGrouping)
    ? (rawGrouping as TimeGrouping)
    : "month";

  return {
    dateFrom,
    dateTo,
    descriptions,
    accountIds,
    categoryIds,
    timeGrouping,
    rawFilters: {
      dateFrom: get("dateFrom"),
      dateTo: get("dateTo"),
      descriptions,
      accountIds,
      categoryIds,
      timeGrouping: rawGrouping,
    },
  };
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;

  const validation = validateDateRange(resolvedParams);
  if (!validation.ok) {
    // Date-independent options still load so the filter bar stays usable to fix the range.
    const [{ accounts, categories }, descriptions] = await Promise.all([
      getTransactionFormOptions(),
      getUniqueDescriptions(),
    ]);
    const { rawFilters } = parseSearchParams(resolvedParams);
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Personal Accounting"
          subnav={<DrilldownTabs section="accounting" />}
          filters={
            <AccountingFiltersUI
              descriptions={descriptions}
              accounts={accounts}
              categories={categories}
              filters={rawFilters as Record<string, string | string[] | number[] | undefined> & {
                dateFrom?: string;
                dateTo?: string;
                descriptions?: string[];
                accountIds?: number[];
                categoryIds?: number[];
                timeGrouping?: string;
              }}
            />
          }
        />
        <DateRangeError message={validation.error} />
      </div>
    );
  }

  const { rawFilters, ...filters } = parseSearchParams(resolvedParams);

  const showToDate = isStandardGrouping(filters.timeGrouping ?? "month");

  const [
    timeSeries,
    periodTotals,
    toDate,
    categoryBreakdown,
    averages,
    { accounts, categories },
    descriptions,
  ] = await Promise.all([
    getAccountingTimeSeries(filters),
    getAccountingPeriodTotals(filters),
    showToDate ? getAccountingToDateComparison(filters) : Promise.resolve(null),
    getExpenseCategoryBreakdown(filters),
    getAccountingMonthlyAverages(filters),
    getTransactionFormOptions(),
    getUniqueDescriptions(),
  ]);

  const incomeChange = toDate ? computeChange(
    toDate.currentIncome,
    toDate.previousIncome,
    toDate.previousMonthLabel
  ) : undefined;
  const expenseChange = toDate ? computeChange(
    toDate.currentExpenses,
    toDate.previousExpenses,
    toDate.previousMonthLabel
  ) : undefined;
  const investmentChange = toDate ? computeChange(
    toDate.currentInvestments,
    toDate.previousInvestments,
    toDate.previousMonthLabel
  ) : undefined;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Personal Accounting"
        subnav={<DrilldownTabs section="accounting" />}
        filters={
          <AccountingFiltersUI
            descriptions={descriptions}
            accounts={accounts}
            categories={categories}
            filters={rawFilters as Record<string, string | string[] | number[] | undefined> & {
              dateFrom?: string;
              dateTo?: string;
              descriptions?: string[];
              accountIds?: number[];
              categoryIds?: number[];
              timeGrouping?: string;
            }}
          />
        }
      />

      {/* ── Charts Row ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <AccountingChart data={timeSeries} timeGrouping={filters.timeGrouping} />
        <ExpensesCategoryChart data={categoryBreakdown} />
      </div>

      {/* ── KPI Cards: Income / Expenses / Investments ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Income column */}
        <div className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold">Income</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {toDate && (
              <AccountingKpiCard
                title="Total Income to Date"
                value={formatCurrency(toDate.currentIncome)}
                subtitle={toDate.currentMonthLabel}
                change={incomeChange}
                positiveDirection="up"
              />
            )}
            <AccountingKpiCard
              title="Total Income in Time Period"
              value={formatCurrency(periodTotals.totalIncome)}
            />
          </div>
          <AccountingKpiCard
            title="Average Income per Month - Last 12 Months"
            value={formatCurrency(averages.totalIncome)}
          />
        </div>

        {/* Expenses column */}
        <div className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold">Expenses</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {toDate && (
              <AccountingKpiCard
                title="Total Expenses to Date"
                value={formatCurrency(toDate.currentExpenses)}
                subtitle={toDate.currentMonthLabel}
                change={expenseChange}
                positiveDirection="down"
              />
            )}
            <AccountingKpiCard
              title="Total Expenses in Time Period"
              value={formatCurrency(periodTotals.totalExpenses)}
            />
          </div>
          <AccountingKpiCard
            title="Average Expenses per Month - Last 12 Months"
            value={formatCurrency(averages.totalExpenses)}
          />
        </div>

        {/* Investments column */}
        <div className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold">Investments</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {toDate && (
              <AccountingKpiCard
                title="Total Investments to Date"
                value={formatCurrency(toDate.currentInvestments)}
                subtitle={toDate.currentMonthLabel}
                change={investmentChange}
                positiveDirection="up"
              />
            )}
            <AccountingKpiCard
              title="Total Investments in Time Period"
              value={formatCurrency(periodTotals.totalInvestments)}
            />
          </div>
          <AccountingKpiCard
            title="Average Investments per Month - Last 12 Months"
            value={formatCurrency(averages.totalInvestments)}
          />
        </div>
      </div>
    </div>
  );
}
