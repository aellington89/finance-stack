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

export const dynamic = "force-dynamic";

const TIME_GROUPING_LABELS: Record<string, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
  day_of_week: "By Day of Week",
  day_of_month: "By Day of Month",
  day_of_year: "By Day of Year",
  week_of_year: "By Week of Year",
  month_of_year: "By Month of Year",
  quarter_of_year: "By Quarter of Year",
};

function FilterSegment({ label, values, maxVisible = 2 }: { label: string; values: string[]; maxVisible?: number }) {
  if (values.length === 0) return null;
  const visible = values.slice(0, maxVisible);
  const overflow = values.length - visible.length;
  return (
    <span className="shrink-0">
      <span className="font-medium text-foreground/70">{label}:</span>{" "}
      {visible.join(", ")}
      {overflow > 0 && (
        <span
          className="cursor-default underline decoration-dotted"
          title={values.join("\n")}
        >
          {" "}+{overflow} more
        </span>
      )}
    </span>
  );
}

function FilterIndicator({
  filters,
  accounts,
  categories,
  includeGrouping,
}: {
  filters: AccountingFilters;
  accounts: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  includeGrouping?: boolean;
}) {
  const fromDate = filters.dateFrom ? new Date(filters.dateFrom + "T00:00:00") : undefined;
  const toDate = filters.dateTo ? new Date(filters.dateTo + "T00:00:00") : undefined;
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const dateLabel = fromDate
    ? toDate ? `${fmt(fromDate)} – ${fmt(toDate)}` : `${fmt(fromDate)} – Present`
    : undefined;

  const descNames = filters.descriptions ?? [];
  const accountNames = (filters.accountIds ?? []).map(id => accounts.find(a => a.id === id)?.name ?? String(id));
  const categoryNames = (filters.categoryIds ?? []).map(id => categories.find(c => c.id === id)?.name ?? String(id));

  const hasFilters = includeGrouping || dateLabel || descNames.length || accountNames.length || categoryNames.length;
  if (!hasFilters) return null;

  return (
    <div className="flex min-w-0 max-w-full items-center gap-x-3 overflow-hidden text-[11px] text-muted-foreground whitespace-nowrap">
      {includeGrouping && filters.timeGrouping && (
        <span className="shrink-0">
          <span className="font-medium text-foreground/70">Grouped:</span>{" "}
          {TIME_GROUPING_LABELS[filters.timeGrouping] ?? filters.timeGrouping}
        </span>
      )}
      {dateLabel && (
        <span className="shrink-0">
          <span className="font-medium text-foreground/70">Period:</span>{" "}
          {dateLabel}
        </span>
      )}
      <FilterSegment label="Descriptions" values={descNames} />
      <FilterSegment label="Accounts" values={accountNames} maxVisible={3} />
      <FilterSegment label="Categories" values={categoryNames} />
    </div>
  );
}

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

  // Default to last 30 days
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const defaultFromStr = defaultFrom.toISOString().slice(0, 10);

  const dateFrom = get("dateFrom") || defaultFromStr;
  const dateTo = get("dateTo") || undefined;
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

  const chartIndicator = <FilterIndicator filters={filters} accounts={accounts} categories={categories} includeGrouping />;
  const kpiIndicator = <FilterIndicator filters={filters} accounts={accounts} categories={categories} />;

  return (
    <div className="space-y-6">
      {/* ── Page Title & Filters ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Personal Accounting Overview</h1>
        <div className="mt-3">
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
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <AccountingChart data={timeSeries} timeGrouping={filters.timeGrouping} description={chartIndicator} />
        <ExpensesCategoryChart data={categoryBreakdown} description={kpiIndicator} />
      </div>

      {/* ── KPI Cards: Income / Expenses / Investments ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Income column */}
        <div className="min-w-0 space-y-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Income</h2>
            {kpiIndicator}
          </div>
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
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Expenses</h2>
            {kpiIndicator}
          </div>
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
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Investments</h2>
            {kpiIndicator}
          </div>
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
