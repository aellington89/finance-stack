import { cookies } from "next/headers";
import {
  getTransactionFormOptions,
  getFilteredTransactions,
  getFilteredTransactionsCount,
  getUniqueDescriptions,
  SORTABLE_COLUMN_KEYS,
  type TransactionFilters,
  type SortableColumn,
  type SortDirection,
} from "@/lib/queries/transactions";
import { getDateRangeFromParams } from "@/lib/queries/date-range";
import { validateDateRange } from "@/lib/validations/date-range";
import {
  getParam,
  validateFilterParams,
  type FilterParams,
} from "@/lib/validations/search-params";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { TransactionFilters as TransactionFiltersUI } from "@/components/transactions/transaction-filters";
import { TransactionList } from "@/components/transactions/transaction-list";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { DrilldownTabs } from "@/components/dashboard/drilldown-tabs";
import { DateRangeError } from "@/components/dashboard/date-range-error";
import {
  VISIBLE_COLUMNS_COOKIE,
  parseVisibleColumnsCookie,
} from "@/components/transactions/transaction-columns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Takes the already-validated filter params (Issue #179) and adds the
// presentation params, which are safe by construction: sortBy/sortDir are
// matched against allowlists and never reach SQL as values, and page/pageSize
// are clamped to a range.
function parseSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
  filterParams: FilterParams
): TransactionFilters {
  const VALID_SORT_DIRS: SortDirection[] = ["asc", "desc"];

  const rawSortBy = getParam(searchParams, "sortBy");
  const rawSortDir = getParam(searchParams, "sortDir");

  const rawPage = getParam(searchParams, "page");
  const rawPageSize = getParam(searchParams, "pageSize");

  const { dateFrom, dateTo } = getDateRangeFromParams(searchParams, {
    applyDefault: false,
  });

  return {
    dateFrom,
    dateTo,
    ...filterParams,
    sortBy: SORTABLE_COLUMN_KEYS.includes(rawSortBy as SortableColumn)
      ? (rawSortBy as SortableColumn)
      : undefined,
    sortDir: VALID_SORT_DIRS.includes(rawSortDir as SortDirection)
      ? (rawSortDir as SortDirection)
      : undefined,
    page: rawPage ? Math.max(1, parseInt(rawPage, 10) || 1) : undefined,
    pageSize: rawPageSize ? Math.max(1, Math.min(100, parseInt(rawPageSize, 10) || 25)) : undefined,
  };
}

export default async function DashboardTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;

  const dateRange = validateDateRange(resolvedParams);
  const filterParams = validateFilterParams(resolvedParams);

  // A rejected filter contributes nothing, so the bar renders with the rest.
  const safeFilters: FilterParams = filterParams.ok ? filterParams : {};

  const paramError = !dateRange.ok
    ? { title: "Invalid date range", message: dateRange.error }
    : !filterParams.ok
      ? { title: "Invalid filter", message: filterParams.error }
      : null;

  if (paramError) {
    // Filter-independent options still load so the bar stays usable to fix it.
    const [{ accounts, types, categories }, descriptions] = await Promise.all([
      getTransactionFormOptions(),
      getUniqueDescriptions(),
    ]);
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Transactions"
          subnav={<DrilldownTabs section="transactions" />}
          filters={
            <TransactionFiltersUI
              descriptions={descriptions}
              accounts={accounts}
              types={types}
              categories={categories}
              filters={parseSearchParams(resolvedParams, safeFilters)}
            />
          }
        />
        <DateRangeError title={paramError.title} message={paramError.message} />
      </div>
    );
  }

  const filters = parseSearchParams(resolvedParams, safeFilters);

  const cookieStore = await cookies();
  const visibleColumns = parseVisibleColumnsCookie(
    cookieStore.get(VISIBLE_COLUMNS_COOKIE)?.value
  );

  const [{ accounts, types, categories }, transactions, descriptions, totalCount] =
    await Promise.all([
      getTransactionFormOptions(),
      getFilteredTransactions(filters),
      getUniqueDescriptions(),
      getFilteredTransactionsCount(filters),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { page: _p, pageSize: _ps, sortBy: _sb, sortDir: _sd, ...filterOnly } = filters;
  const hasFilters = Object.values(filterOnly).some(
    (v) => v !== undefined && (typeof v !== "object" || (v as unknown[]).length > 0)
  );

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Transactions"
        subnav={<DrilldownTabs section="transactions" />}
        filters={
          <TransactionFiltersUI
            descriptions={descriptions}
            accounts={accounts}
            types={types}
            categories={categories}
            filters={filters}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,380px)]">
        <Card className="min-w-0">
          <CardContent>
            <TransactionList
              transactions={transactions}
              hasFilters={hasFilters}
              sortBy={filters.sortBy}
              sortDir={filters.sortDir}
              page={filters.page ?? 1}
              pageSize={filters.pageSize ?? 25}
              totalCount={totalCount}
              accounts={accounts}
              types={types}
              categories={categories}
              visibleColumns={visibleColumns}
            />
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>New Transaction</CardTitle>
          </CardHeader>
          <CardContent>
            <TransactionForm
              accounts={accounts}
              types={types}
              categories={categories}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
