import {
  getTransactionFormOptions,
  getFilteredTransactions,
  getFilteredTransactionsCount,
  getUniqueDescriptions,
  type TransactionFilters,
  type SortableColumn,
  type SortDirection,
} from "@/lib/queries/transactions";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { TransactionFilters as TransactionFiltersUI } from "@/components/transactions/transaction-filters";
import { TransactionList } from "@/components/transactions/transaction-list";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

function parseSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): TransactionFilters {
  const get = (key: string): string | undefined => {
    const val = searchParams[key];
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

  const VALID_SORT_COLUMNS: SortableColumn[] = [
    "transactionDate", "transactionDescription", "amount",
    "accountName", "transactionType", "transactionCategory",
  ];
  const VALID_SORT_DIRS: SortDirection[] = ["asc", "desc"];

  const rawSortBy = get("sortBy");
  const rawSortDir = get("sortDir");

  const rawPage = get("page");
  const rawPageSize = get("pageSize");

  return {
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    descriptions: getStringArray("descriptions"),
    amount: get("amount"),
    accountIds: getNumberArray("accountIds"),
    typeIds: getNumberArray("typeIds"),
    categoryIds: getNumberArray("categoryIds"),
    sortBy: VALID_SORT_COLUMNS.includes(rawSortBy as SortableColumn)
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
  const filters = parseSearchParams(resolvedParams);

  const [{ accounts, types, categories }, transactions, descriptions, totalCount] =
    await Promise.all([
      getTransactionFormOptions(),
      getFilteredTransactions(filters),
      getUniqueDescriptions(),
      getFilteredTransactionsCount(filters),
    ]);

  const { page: _p, pageSize: _ps, sortBy: _sb, sortDir: _sd, ...filterOnly } = filters;
  const hasFilters = Object.values(filterOnly).some(
    (v) => v !== undefined && (typeof v !== "object" || (v as unknown[]).length > 0)
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,380px)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <TransactionFiltersUI
            descriptions={descriptions}
            accounts={accounts}
            types={types}
            categories={categories}
            filters={filters}
          />
        </CardHeader>
        <CardContent>
          <TransactionList
            transactions={transactions}
            hasFilters={hasFilters}
            sortBy={filters.sortBy}
            sortDir={filters.sortDir}
            page={filters.page ?? 1}
            pageSize={filters.pageSize ?? 25}
            totalCount={totalCount}
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
  );
}
