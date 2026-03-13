import {
  getTransactionFormOptions,
  getFilteredTransactions,
  getUniqueDescriptions,
  type TransactionFilters,
  type SortableColumn,
  type SortDirection,
} from "@/lib/queries/transactions";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { TransactionFilters as TransactionFiltersUI } from "@/components/transactions/transaction-filters";
import { TransactionList } from "@/components/transactions/transaction-list";

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
  };
}

export default async function DashboardTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const filters = parseSearchParams(resolvedParams);

  const [{ accounts, types, categories }, transactions, descriptions] =
    await Promise.all([
      getTransactionFormOptions(),
      getFilteredTransactions(filters),
      getUniqueDescriptions(),
    ]);

  const hasFilters = Object.values(filters).some(
    (v) => v !== undefined && (typeof v !== "object" || (v as unknown[]).length > 0)
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,380px)]">
      <section className="min-w-0 space-y-4">
        <TransactionFiltersUI
          descriptions={descriptions}
          accounts={accounts}
          types={types}
          categories={categories}
          filters={filters}
        />
        <TransactionList
          transactions={transactions}
          hasFilters={hasFilters}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
        />
      </section>

      <section>
        <h3 className="text-base font-semibold mb-4">New Transaction</h3>
        <TransactionForm
          accounts={accounts}
          types={types}
          categories={categories}
        />
      </section>
    </div>
  );
}
