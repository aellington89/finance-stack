import { db } from "@/lib/db";
import { accounts, transactionTypes, transactionCategories, vTransactionsFull } from "@/drizzle/schema";
import { isNull, desc, asc, and, gte, lte, inArray, eq, sql, type SQL, type Column } from "drizzle-orm";

export type SortableColumn =
  | "transactionDate"
  | "transactionDescription"
  | "amount"
  | "accountName"
  | "transactionType"
  | "transactionCategory";

export type SortDirection = "asc" | "desc";

const SORTABLE_COLUMNS: Record<SortableColumn, Column> = {
  transactionDate: vTransactionsFull.transactionDate,
  transactionDescription: vTransactionsFull.transactionDescription,
  amount: vTransactionsFull.amount,
  accountName: vTransactionsFull.accountName,
  transactionType: vTransactionsFull.transactionType,
  transactionCategory: vTransactionsFull.transactionCategory,
};

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

function buildWhereClause(filters: TransactionFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.dateFrom) {
    conditions.push(gte(vTransactionsFull.transactionDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(vTransactionsFull.transactionDate, filters.dateTo));
  }
  if (filters.descriptions && filters.descriptions.length > 0) {
    conditions.push(inArray(vTransactionsFull.transactionDescription, filters.descriptions));
  }
  if (filters.amount) {
    conditions.push(eq(vTransactionsFull.amount, filters.amount));
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    conditions.push(inArray(vTransactionsFull.accountId, filters.accountIds));
  }
  if (filters.typeIds && filters.typeIds.length > 0) {
    conditions.push(inArray(vTransactionsFull.transactionTypeId, filters.typeIds));
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    conditions.push(inArray(vTransactionsFull.transactionCategoryId, filters.categoryIds));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getFilteredTransactionsCount(filters: TransactionFilters): Promise<number> {
  const where = buildWhereClause(filters);
  const query = db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(vTransactionsFull);

  const [result] = where ? await query.where(where) : await query;
  return result.count;
}

export async function getFilteredTransactions(filters: TransactionFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const where = buildWhereClause(filters);

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

export async function getUniqueDescriptions() {
  const rows = await db
    .selectDistinct({ description: vTransactionsFull.transactionDescription })
    .from(vTransactionsFull)
    .orderBy(vTransactionsFull.transactionDescription);

  return rows
    .map((r) => r.description)
    .filter((d): d is string => d !== null);
}
