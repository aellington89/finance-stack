import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import {
  getAccountingTimeSeries,
  getAccountingPeriodTotals,
  getAccountingToDateComparison,
  getExpenseCategoryBreakdown,
  getAccountingMonthlyAverages,
} from "@/lib/queries/accounting";
import {
  INCOME_TYPE,
  EXPENSE_TYPE,
  INVESTMENT_TYPE,
} from "@/lib/constants/reference-ids";

// All transactions are scoped to a freshly created account and filtered by
// `accountIds`, so these tests never see seed data and assert exact totals.
//
// The dated queries use a 2020 window (outside the mock-data seed range); the
// monthly-averages query has its own fixed "last 12 complete months" window, so
// it gets a separate row in a recent complete month (~3 months ago).

const TYPE_CASH = 1; // account_types row guaranteed by vitest-setup.ts

// Categories guaranteed by vitest-setup.ts upserts.
const CAT_OTHER = 6; // "Other"
const CAT_CC_INTEREST = 80; // "Credit Card Interest"

// A day in a complete month inside the trailing-12-month averages window.
const RECENT = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 3, 15)
)
  .toISOString()
  .slice(0, 10);

const createdAccountIds: number[] = [];

async function createAccount(name: string): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId: TYPE_CASH })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

async function insertTxn(
  accountId: number,
  date: string,
  amount: string,
  transactionTypeId: number,
  transactionCategoryId: number,
  description = "test txn"
) {
  await db.insert(transactions).values({
    transactionDescription: description,
    transactionDate: date,
    accountId,
    amount,
    transactionTypeId,
    transactionCategoryId,
  });
}

let accountId: number;

beforeEach(async () => {
  accountId = await createAccount("Accounting Test Acct");

  // ── 2020 window (dated queries) ──
  // Jan 2020
  await insertTxn(accountId, "2020-01-10", "300.00", INCOME_TYPE.id, CAT_OTHER);
  await insertTxn(accountId, "2020-01-15", "-50.00", EXPENSE_TYPE.id, CAT_OTHER);
  // Feb 2020
  await insertTxn(accountId, "2020-02-05", "1000.00", INCOME_TYPE.id, CAT_OTHER);
  await insertTxn(accountId, "2020-02-12", "500.00", INCOME_TYPE.id, CAT_OTHER);
  await insertTxn(accountId, "2020-02-18", "-400.00", EXPENSE_TYPE.id, CAT_OTHER);
  await insertTxn(accountId, "2020-02-20", "-100.00", EXPENSE_TYPE.id, CAT_CC_INTEREST);
  await insertTxn(accountId, "2020-02-25", "-200.00", INVESTMENT_TYPE.id, CAT_OTHER);

  // ── Recent complete month (monthly-averages window) ──
  await insertTxn(accountId, RECENT, "1200.00", INCOME_TYPE.id, CAT_OTHER);
  await insertTxn(accountId, RECENT, "-600.00", EXPENSE_TYPE.id, CAT_OTHER);
  await insertTxn(accountId, RECENT, "-300.00", INVESTMENT_TYPE.id, CAT_OTHER);
});

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    await db
      .delete(transactions)
      .where(inArray(transactions.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
    createdAccountIds.length = 0;
  }
});

// ────────────────────────────────────────────────────────────────────
// getAccountingPeriodTotals
// ────────────────────────────────────────────────────────────────────

describe("getAccountingPeriodTotals", () => {
  it("sums income/expense/investment (via ABS) over the date range", async () => {
    const result = await getAccountingPeriodTotals({
      dateFrom: "2020-01-01",
      dateTo: "2020-02-29",
      accountIds: [accountId],
    });

    expect(result.totalIncome).toBeCloseTo(1800, 2); // 300 + 1000 + 500
    expect(result.totalExpenses).toBeCloseTo(550, 2); // |−50| + |−400| + |−100|
    expect(result.totalInvestments).toBeCloseTo(200, 2); // |−200|
  });

  it("returns zeros (not null) when nothing matches the range", async () => {
    const result = await getAccountingPeriodTotals({
      dateFrom: "2019-01-01",
      dateTo: "2019-12-31",
      accountIds: [accountId],
    });

    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalInvestments).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// getAccountingTimeSeries
// ────────────────────────────────────────────────────────────────────

describe("getAccountingTimeSeries", () => {
  it("buckets totals by month across the range", async () => {
    const result = await getAccountingTimeSeries({
      dateFrom: "2020-01-01",
      dateTo: "2020-02-29",
      accountIds: [accountId],
      timeGrouping: "month",
    });

    const jan = result.find((p) => p.date.startsWith("2020-01"));
    const feb = result.find((p) => p.date.startsWith("2020-02"));

    expect(jan).toBeDefined();
    expect(jan!.totalIncome).toBeCloseTo(300, 2);
    expect(jan!.totalExpenses).toBeCloseTo(50, 2);
    expect(jan!.totalInvestments).toBeCloseTo(0, 2);

    expect(feb).toBeDefined();
    expect(feb!.totalIncome).toBeCloseTo(1500, 2);
    expect(feb!.totalExpenses).toBeCloseTo(500, 2);
    expect(feb!.totalInvestments).toBeCloseTo(200, 2);
  });
});

// ────────────────────────────────────────────────────────────────────
// getAccountingToDateComparison
// ────────────────────────────────────────────────────────────────────

describe("getAccountingToDateComparison", () => {
  it("compares the current month-to-date against the prior month", async () => {
    const result = await getAccountingToDateComparison({
      dateTo: "2020-02-29", // reference date → current = Feb, previous = Jan
      accountIds: [accountId],
      timeGrouping: "month",
    });

    expect(result.currentIncome).toBeCloseTo(1500, 2);
    expect(result.previousIncome).toBeCloseTo(300, 2);
    expect(result.currentExpenses).toBeCloseTo(500, 2);
    expect(result.previousExpenses).toBeCloseTo(50, 2);
    expect(result.currentInvestments).toBeCloseTo(200, 2);
    expect(result.previousInvestments).toBeCloseTo(0, 2);
  });
});

// ────────────────────────────────────────────────────────────────────
// getExpenseCategoryBreakdown
// ────────────────────────────────────────────────────────────────────

describe("getExpenseCategoryBreakdown", () => {
  it("groups expenses by category, ordered by total descending", async () => {
    const result = await getExpenseCategoryBreakdown({
      dateFrom: "2020-01-01",
      dateTo: "2020-02-29",
      accountIds: [accountId],
    });

    const other = result.find((r) => r.category === "Other");
    const ccInterest = result.find((r) => r.category === "Credit Card Interest");

    expect(other?.total).toBeCloseTo(450, 2); // |−50| + |−400|
    expect(ccInterest?.total).toBeCloseTo(100, 2); // |−100|

    // Ordered by total DESC: "Other" (450) precedes "Credit Card Interest" (100).
    const otherIdx = result.findIndex((r) => r.category === "Other");
    const ccIdx = result.findIndex((r) => r.category === "Credit Card Interest");
    expect(otherIdx).toBeLessThan(ccIdx);
  });
});

// ────────────────────────────────────────────────────────────────────
// getAccountingMonthlyAverages
// ────────────────────────────────────────────────────────────────────

describe("getAccountingMonthlyAverages", () => {
  it("averages over complete months in the trailing-12-month window", async () => {
    // Only the single recent month has rows for this account, so the averages
    // equal that month's totals. (The 2020 rows fall outside the window.)
    const result = await getAccountingMonthlyAverages({
      accountIds: [accountId],
    });

    expect(result.totalIncome).toBeCloseTo(1200, 2);
    expect(result.totalExpenses).toBeCloseTo(600, 2);
    expect(result.totalInvestments).toBeCloseTo(300, 2);
  });
});
