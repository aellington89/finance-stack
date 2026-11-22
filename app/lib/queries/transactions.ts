import { db } from "@/lib/db";
import { accounts, transactions, transactionTypes, transactionCategories, vTransactionsFull } from "@/drizzle/schema";
import { isNull, desc, asc, and, gte, lte, inArray, eq, sql, type SQL, type Column } from "drizzle-orm";

export type SortableColumn =
  | "transactionDate"
  | "transactionDescription"
  | "amount"
  | "accountName"
  | "relatedAccountName"
  | "transactionType"
  | "transactionCategory";

export type SortDirection = "asc" | "desc";

const SORTABLE_COLUMNS: Record<SortableColumn, Column> = {
  transactionDate: vTransactionsFull.transactionDate,
  transactionDescription: vTransactionsFull.transactionDescription,
  amount: vTransactionsFull.amount,
  accountName: vTransactionsFull.accountName,
  relatedAccountName: vTransactionsFull.relatedAccountName,
  transactionType: vTransactionsFull.transactionType,
  transactionCategory: vTransactionsFull.transactionCategory,
};

export const SORTABLE_COLUMN_KEYS = Object.keys(SORTABLE_COLUMNS) as SortableColumn[];

export interface TransactionFilters {
  dateFrom?: string;
  dateTo?: string;
  descriptions?: string[];
  amount?: string;
  accountIds?: number[];
  typeIds?: number[];
  categoryIds?: number[];
  sortBy?: SortableColumn;
  sortDir?: SortDirection;
  page?: number;
  pageSize?: number;
}

export async function getTransactionFormOptions() {
  const [accountList, typeList, categoryList] = await Promise.all([
    db
      .select({ id: accounts.accountId, name: accounts.accountName })
      .from(accounts)
      .where(isNull(accounts.closedDate))
      .orderBy(accounts.accountName),
    db
      .select({ id: transactionTypes.transactionTypeId, name: transactionTypes.transactionType })
      .from(transactionTypes)
      .orderBy(transactionTypes.transactionType),
    db
      .select({
        id: transactionCategories.transactionCategoryId,
        name: transactionCategories.transactionCategory,
      })
      .from(transactionCategories)
      .orderBy(transactionCategories.transactionCategory),
  ]);

  return { accounts: accountList, types: typeList, categories: categoryList };
}

type FilterColumn =
  | "transactionDate"
  | "transactionDescription"
  | "amount"
  | "accountId"
  | "transactionTypeId"
  | "transactionCategoryId";

/** `transactions` or `vTransactionsFull`: both name the filter columns alike. */
type FilterSource = Pick<typeof transactions, FilterColumn> | Pick<typeof vTransactionsFull, FilterColumn>;

// One builder for both sources, so the count and the page can't filter apart.
function buildWhereClause(filters: TransactionFilters, source: FilterSource): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.dateFrom) {
    conditions.push(gte(source.transactionDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(source.transactionDate, filters.dateTo));
  }
  if (filters.descriptions && filters.descriptions.length > 0) {
    conditions.push(inArray(source.transactionDescription, filters.descriptions));
  }
  if (filters.amount) {
    conditions.push(eq(source.amount, filters.amount));
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    conditions.push(inArray(source.accountId, filters.accountIds));
  }
  if (filters.typeIds && filters.typeIds.length > 0) {
    conditions.push(inArray(source.transactionTypeId, filters.typeIds));
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    conditions.push(inArray(source.transactionCategoryId, filters.categoryIds));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// The count and getUniqueDescriptions read `transactions`, not the view, to skip
// its five joins (Issue #146). They return what the view would because every
// inner join in v_transactions_full follows a NOT NULL foreign key, and its
// only outer join (the related account) never drops a row.
// tests/integration/queries/transactions.test.ts compares them with the view, on
// its own rows and on the whole test database, so a join added to the view that
// drops any of those rows fails it.
export async function getFilteredTransactionsCount(filters: TransactionFilters): Promise<number> {
  const where = buildWhereClause(filters, transactions);
  const query = db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(transactions);

  const [result] = where ? await query.where(where) : await query;
  return result.count;
}

export async function getFilteredTransactions(filters: TransactionFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const where = buildWhereClause(filters, vTransactionsFull);

  const sortColumn = filters.sortBy && SORTABLE_COLUMNS[filters.sortBy]
    ? SORTABLE_COLUMNS[filters.sortBy]
    : vTransactionsFull.transactionDate;
  const sortFn = filters.sortDir === "asc" ? asc : desc;

  const query = db
    .select()
    .from(vTransactionsFull)
    .orderBy(sortFn(sortColumn), desc(vTransactionsFull.transactionId))
    .limit(pageSize)
    .offset(offset);

  return where ? query.where(where) : query;
}

// Reads `transactions` for the reason given above getFilteredTransactionsCount.
// The column is NOT NULL and never blank, so the list is the view's.
export async function getUniqueDescriptions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ description: transactions.transactionDescription })
    .from(transactions)
    .orderBy(transactions.transactionDescription);

  return rows.map((r) => r.description);
}
