import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  accounts,
  accountBalanceHistory,
  transactionCategories,
  transactions,
  vTransactionsFull,
} from "@/drizzle/schema";
import { asc, desc, eq, inArray, sql, type Column } from "drizzle-orm";
import {
  getFilteredTransactions,
  getFilteredTransactionsCount,
  getUniqueDescriptions,
  SORTABLE_COLUMN_KEYS,
  type SortableColumn,
  type TransactionFilters,
} from "@/lib/queries/transactions";

// Issue #146. The count and the description list read `transactions`, and the
// page reads `v_transactions_full`. They agree only while every inner join in
// the view follows a NOT NULL foreign key, so these tests compare each one with
// the view. Dated in 2020, outside the mock-data window, and scoped to this
// file's own category or accounts, except the two whole-table comparisons. All
// figures are synthetic. The fixture is read-only, so it is built once.
//
// The two whole-table comparisons read the database twice, so a write between
// the reads fails them. fileParallelism: false keeps other test files out; a
// `next dev` server (`npm run dev` or `npm run dev:verify`) on the same
// Finances_Test can still write through its recurring scheduler, so stop it or
// set RECURRING_SCHEDULER=off.

const TYPE_CHECKING = 2;
const TYPE_CREDIT_CARD = 15;
const INTERNAL_TRANSFER = 1;
const EXPENSE = 2;

const tag = Date.now();
const D1 = `Txn146 test one ${tag}`;
const D2 = `Txn146 test two ${tag}`;
const D3 = `Txn146 test three ${tag}`;

const createdTxIds: number[] = [];
const createdAccountIds: number[] = [];
let category: number;
let alpha: number;
let beta: number;

async function createAccount(name: string, accountTypeId: number): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

async function insertTx(
  accountId: number,
  date: string,
  amount: string,
  typeId: number,
  description: string,
  relatedAccountId: number | null = null
) {
  const [row] = await db
    .insert(transactions)
    .values({
      transactionDescription: description,
      transactionDate: date,
      accountId,
      amount,
      relatedAccountId,
      transactionTypeId: typeId,
      transactionCategoryId: category,
    })
    .returning({ transactionId: transactions.transactionId });
  createdTxIds.push(row.transactionId);
}

beforeAll(async () => {
  const [cat] = await db
    .insert(transactionCategories)
    .values({ transactionCategory: `Txn146 test category ${tag}` })
    .returning({ id: transactionCategories.transactionCategoryId });
  category = cat.id;
  alpha = await createAccount(`Txn146 Test - Alpha ${tag}`, TYPE_CHECKING);
  beta = await createAccount(`Txn146 Test - Beta ${tag}`, TYPE_CREDIT_CARD);

  // Seven rows. Three have a related account and four don't. D1 is on three
  // rows, D2 and D3 on two each.
  await insertTx(alpha, "2020-01-05", "-10.00", EXPENSE, D1);
  await insertTx(alpha, "2020-02-10", "-25.50", EXPENSE, D2);
  await insertTx(alpha, "2020-03-15", "-10.00", INTERNAL_TRANSFER, D3, beta);
  await insertTx(beta, "2020-03-15", "10.00", INTERNAL_TRANSFER, D3, alpha);
  await insertTx(beta, "2020-04-20", "-25.50", EXPENSE, D1);
  await insertTx(beta, "2020-05-25", "100.00", EXPENSE, D2);
  await insertTx(alpha, "2020-06-30", "100.00", INTERNAL_TRANSFER, D1, beta);
});

afterAll(async () => {
  if (createdTxIds.length > 0) {
    await db.delete(transactions).where(inArray(transactions.transactionId, createdTxIds));
  }
  if (createdAccountIds.length > 0) {
    await db.delete(accountBalanceHistory).where(inArray(accountBalanceHistory.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
  }
  if (category !== undefined) {
    await db
      .delete(transactionCategories)
      .where(eq(transactionCategories.transactionCategoryId, category));
  }
});

// Functions, because the ids exist only once beforeAll has run.
const FILTER_CASES: [string, () => TransactionFilters, number][] = [
  ["category", () => ({ categoryIds: [category] }), 7],
  ["date from", () => ({ categoryIds: [category], dateFrom: "2020-03-15" }), 5],
  ["date to", () => ({ categoryIds: [category], dateTo: "2020-03-15" }), 4],
  ["descriptions", () => ({ categoryIds: [category], descriptions: [D1, D2] }), 5],
  ["amount", () => ({ categoryIds: [category], amount: "-10.00" }), 2],
  ["types", () => ({ categoryIds: [category], typeIds: [INTERNAL_TRANSFER] }), 3],
  ["one account", () => ({ accountIds: [beta] }), 3],
  ["both accounts", () => ({ accountIds: [alpha, beta] }), 7],
  [
    "every filter combined",
    () => ({
      dateFrom: "2020-02-01",
      dateTo: "2020-05-31",
      descriptions: [D1, D3],
      amount: "-10.00",
      accountIds: [alpha, beta],
      typeIds: [INTERNAL_TRANSFER, EXPENSE],
      categoryIds: [category],
    }),
    1,
  ],
];

describe("getFilteredTransactionsCount", () => {
  it("counts every row the view has, with no filter", async () => {
    const [view] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(vTransactionsFull);

    expect(await getFilteredTransactionsCount({})).toBe(view.count);
  });

  it.each(FILTER_CASES)("matches the page's rows under the %s filter", async (_, filters, expected) => {
    const f = filters();
    const rows = await getFilteredTransactions({ ...f, pageSize: 10_000 });

    expect(await getFilteredTransactionsCount(f)).toBe(expected);
    expect(rows).toHaveLength(expected);
  });
});

describe("getUniqueDescriptions", () => {
  it("lists every description the view has, once each, in the same order", async () => {
    const view = await db
      .selectDistinct({ description: vTransactionsFull.transactionDescription })
      .from(vTransactionsFull)
      .orderBy(vTransactionsFull.transactionDescription);

    const list = await getUniqueDescriptions();
    expect(list).toEqual(view.map((r) => r.description));
    expect(list.filter((d) => d === D1)).toHaveLength(1);
    expect(list).toEqual(expect.arrayContaining([D1, D2, D3]));
  });
});

describe("getFilteredTransactions", () => {
  // Kept apart from the query module's own map, so a wrong entry there fails.
  const VIEW_COLUMNS: Record<SortableColumn, Column> = {
    transactionDate: vTransactionsFull.transactionDate,
    transactionDescription: vTransactionsFull.transactionDescription,
    amount: vTransactionsFull.amount,
    accountName: vTransactionsFull.accountName,
    relatedAccountName: vTransactionsFull.relatedAccountName,
    transactionType: vTransactionsFull.transactionType,
    transactionCategory: vTransactionsFull.transactionCategory,
  };

  /** The fixture's ids, ordered as the page orders them, ties broken newest id first. */
  const oracle = async (column: Column, dir: typeof asc) =>
    (
      await db
        .select({ id: vTransactionsFull.transactionId })
        .from(vTransactionsFull)
        .where(eq(vTransactionsFull.transactionCategoryId, category))
        .orderBy(dir(column), desc(vTransactionsFull.transactionId))
    ).map((r) => r.id);

  const sortCases = SORTABLE_COLUMN_KEYS.flatMap((key) =>
    (["asc", "desc"] as const).map((dir) => [key, dir] as const)
  );

  it.each(sortCases)("orders by %s %s, then the newest id", async (sortBy, sortDir) => {
    const rows = await getFilteredTransactions({
      categoryIds: [category],
      sortBy,
      sortDir,
      pageSize: 10_000,
    });

    const expected = await oracle(VIEW_COLUMNS[sortBy], sortDir === "asc" ? asc : desc);
    expect(expected).toHaveLength(7);
    expect(rows.map((r) => r.transactionId)).toEqual(expected);
  });

  it("pages by the default order, newest date first", async () => {
    const rows = await getFilteredTransactions({ categoryIds: [category], page: 2, pageSize: 3 });

    const all = await oracle(vTransactionsFull.transactionDate, desc);
    expect(rows.map((r) => r.transactionId)).toEqual(all.slice(3, 6));
  });
});
