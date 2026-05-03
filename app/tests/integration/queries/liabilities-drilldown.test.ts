import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  accounts,
  accountBalanceHistory,
  transactions,
} from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import {
  getDebtServiceSummary,
  getDebtWaterfall,
  getLiabilityAllocation,
  getLiabilityPerformance,
  getLiabilityTrendDecomposition,
  type DebtServiceAccount,
  type DebtServiceData,
} from "@/lib/queries/liabilities-drilldown";

function findDebtServiceAccount(
  data: DebtServiceData,
  accountId: number
): DebtServiceAccount | undefined {
  for (const cat of data.categories) {
    for (const type of cat.accountTypes) {
      const acc = type.accounts.find((a) => a.accountId === accountId);
      if (acc) return acc;
    }
  }
  return undefined;
}
import {
  DEBT_INTEREST_CATEGORY_IDS,
  DEBT_PAYMENT_CATEGORY_IDS,
} from "@/lib/queries/liability-categories";

// Test dates — outside the 12-month mock-data window so queries scoped to
// these dates only return rows this file inserts.
const SNAPSHOT_DATE = "2020-06-30";
const PERF_START = "2020-01-01";
const PERF_END = "2020-12-31";

// Account-type IDs from init-db/seeds/finances-test-mock-data.sql.
const TYPE_CHECKING = 2; // Current Asset
const TYPE_CREDIT_CARD = 15; // Current Liability
const TYPE_MORTGAGE = 17; // Non-current Liability
const TYPE_AUTO_LOAN = 19; // Non-current Liability

const createdAccountIds: number[] = [];
const createdTxIds: number[] = [];

async function createAccount(
  name: string,
  accountTypeId: number
): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

async function insertBalance(
  accountId: number,
  balanceDate: string,
  cumulativeBalance: string
) {
  await db.insert(accountBalanceHistory).values({
    accountId,
    balanceDate,
    dailyBalance: "0.00",
    cumulativeBalance,
  });
}

async function insertTx(
  accountId: number,
  date: string,
  amount: string,
  transactionCategoryId: number,
  transactionTypeId = 2
): Promise<number> {
  const [row] = await db
    .insert(transactions)
    .values({
      transactionDescription: "test",
      transactionDate: date,
      accountId,
      amount,
      transactionTypeId,
      transactionCategoryId,
    })
    .returning({ transactionId: transactions.transactionId });
  createdTxIds.push(row.transactionId);
  return row.transactionId;
}

afterEach(async () => {
  if (createdTxIds.length > 0) {
    await db
      .delete(transactions)
      .where(inArray(transactions.transactionId, createdTxIds));
    createdTxIds.length = 0;
  }
  if (createdAccountIds.length > 0) {
    await db
      .delete(accountBalanceHistory)
      .where(inArray(accountBalanceHistory.accountId, createdAccountIds));
    await db
      .delete(accounts)
      .where(inArray(accounts.accountId, createdAccountIds));
    createdAccountIds.length = 0;
  }
});

// ────────────────────────────────────────────────────────────────────
// getLiabilityAllocation
// ────────────────────────────────────────────────────────────────────

describe("getLiabilityAllocation", () => {
  it("aggregates negative balances by category and account type", async () => {
    const cardId = await createAccount("Alloc Card", TYPE_CREDIT_CARD);
    const mortgageId = await createAccount("Alloc Mortgage", TYPE_MORTGAGE);
    const autoId = await createAccount("Alloc Auto", TYPE_AUTO_LOAN);
    const checkingId = await createAccount("Alloc Checking", TYPE_CHECKING);

    await insertBalance(cardId, SNAPSHOT_DATE, "-500.00");
    await insertBalance(mortgageId, SNAPSHOT_DATE, "-200000.00");
    await insertBalance(autoId, SNAPSHOT_DATE, "-15000.00");
    await insertBalance(checkingId, SNAPSHOT_DATE, "5000.00");

    const result = await getLiabilityAllocation(SNAPSHOT_DATE);

    // Total is negative — raw sign preserved.
    expect(result.totalLiabilities).toBe(-500 - 200000 - 15000);
    expect(result.currentLiabilities).toBe(-500);
    expect(result.nonCurrentLiabilities).toBe(-215000);

    // No asset categories.
    for (const cat of result.byCategory) {
      expect([5, 6]).toContain(cat.categoryId);
    }

    // Children sum to parent.
    for (const cat of result.byCategory) {
      const childSum = cat.children.reduce((s, c) => s + c.value, 0);
      expect(childSum).toBeCloseTo(cat.value, 2);
    }
  });

  it("category percentOfTotal sums to ~100", async () => {
    const cardId = await createAccount("Pct Card", TYPE_CREDIT_CARD);
    const mortgageId = await createAccount("Pct Mortgage", TYPE_MORTGAGE);
    await insertBalance(cardId, SNAPSHOT_DATE, "-1000.00");
    await insertBalance(mortgageId, SNAPSHOT_DATE, "-3000.00");

    const result = await getLiabilityAllocation(SNAPSHOT_DATE);

    const pctSum = result.byCategory.reduce(
      (s, c) => s + c.percentOfTotal,
      0
    );
    expect(pctSum).toBeGreaterThan(99.5);
    expect(pctSum).toBeLessThan(100.5);
  });

  it("returns an empty allocation for a date with no liabilities", async () => {
    const result = await getLiabilityAllocation("1999-01-01");
    expect(result.totalLiabilities).toBe(0);
    expect(result.byCategory).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// getLiabilityPerformance
// ────────────────────────────────────────────────────────────────────

describe("getLiabilityPerformance", () => {
  it("returns hierarchical change with category = sum(type) = sum(account)", async () => {
    const cardId = await createAccount("Perf Card", TYPE_CREDIT_CARD);
    const mortgageId = await createAccount("Perf Mortgage", TYPE_MORTGAGE);

    await insertBalance(cardId, PERF_START, "-1000.00");
    await insertBalance(cardId, PERF_END, "-800.00"); // paid down 200
    await insertBalance(mortgageId, PERF_START, "-200000.00");
    await insertBalance(mortgageId, PERF_END, "-195000.00"); // paid down 5000

    const result = await getLiabilityPerformance(PERF_START, PERF_END);

    expect(result.totalCurrentValue).toBe(-800 + -195000);
    expect(result.totalStartValue).toBe(-1000 + -200000);
    // change > 0 = paydown.
    expect(result.totalChange).toBeCloseTo(5200, 2);

    for (const cat of result.categories) {
      expect([5, 6]).toContain(cat.categoryId);
      expect(cat.change).toBeCloseTo(cat.currentValue - cat.startValue, 2);

      const typeSum = cat.accountTypes.reduce(
        (s, t) => s + t.currentValue,
        0
      );
      expect(typeSum).toBeCloseTo(cat.currentValue, 2);

      for (const type of cat.accountTypes) {
        const acctSum = type.accounts.reduce(
          (s, a) => s + a.currentValue,
          0
        );
        expect(acctSum).toBeCloseTo(type.currentValue, 2);
      }
    }
  });

  it("returns null percentChange when start balance is zero", async () => {
    const cardId = await createAccount("New Card", TYPE_CREDIT_CARD);
    // Account opened mid-period: start_balance = 0, end_balance = -250.
    await insertBalance(cardId, PERF_START, "0.00");
    await insertBalance(cardId, PERF_END, "-250.00");

    const result = await getLiabilityPerformance(PERF_START, PERF_END);

    const cat = result.categories.find((c) => c.categoryId === 5);
    const type = cat?.accountTypes.find(
      (t) => t.accountTypeId === TYPE_CREDIT_CARD
    );
    const acct = type?.accounts.find((a) => a.accountId === cardId);
    expect(acct?.percentChange).toBeNull();
  });

  it("scopes to liability categories only (asset rows excluded)", async () => {
    const cardId = await createAccount("Scope Card", TYPE_CREDIT_CARD);
    const checkingId = await createAccount("Scope Checking", TYPE_CHECKING);

    await insertBalance(cardId, PERF_START, "-100.00");
    await insertBalance(cardId, PERF_END, "-50.00");
    await insertBalance(checkingId, PERF_START, "1000.00");
    await insertBalance(checkingId, PERF_END, "1500.00");

    const result = await getLiabilityPerformance(PERF_START, PERF_END);

    for (const cat of result.categories) {
      expect([5, 6]).toContain(cat.categoryId);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// getLiabilityTrendDecomposition
// ────────────────────────────────────────────────────────────────────

describe("getLiabilityTrendDecomposition", () => {
  it("returns rows only for liability categories within the date range", async () => {
    const cardId = await createAccount("Trend Card", TYPE_CREDIT_CARD);
    const mortgageId = await createAccount("Trend Mortgage", TYPE_MORTGAGE);
    const checkingId = await createAccount("Trend Checking", TYPE_CHECKING);

    await insertBalance(cardId, PERF_START, "-100.00");
    await insertBalance(cardId, PERF_END, "-50.00");
    await insertBalance(mortgageId, PERF_START, "-50000.00");
    await insertBalance(mortgageId, PERF_END, "-49500.00");
    await insertBalance(checkingId, PERF_START, "200.00");

    const rows = await getLiabilityTrendDecomposition(PERF_START, PERF_END);

    for (const r of rows) {
      expect([5, 6]).toContain(r.categoryId);
      expect(r.cumulativeBalance).toBeLessThanOrEqual(0);
      expect(r.date >= PERF_START && r.date <= PERF_END).toBe(true);
    }

    const myIds = new Set([cardId, mortgageId]);
    const mine = rows.filter((r) => myIds.has(r.accountId));
    expect(mine).toHaveLength(4);
  });

  it("respects dateFrom/dateTo bounds", async () => {
    const cardId = await createAccount("Bounds Card", TYPE_CREDIT_CARD);
    await insertBalance(cardId, "2019-01-01", "-50.00");
    await insertBalance(cardId, "2020-06-30", "-100.00");
    await insertBalance(cardId, "2021-12-31", "-150.00");

    const rows = await getLiabilityTrendDecomposition(
      "2020-01-01",
      "2020-12-31"
    );
    const mine = rows.filter((r) => r.accountId === cardId);

    expect(mine).toHaveLength(1);
    expect(mine[0].date).toBe("2020-06-30");
  });
});

// ────────────────────────────────────────────────────────────────────
// getDebtServiceSummary
// ────────────────────────────────────────────────────────────────────

describe("getDebtServiceSummary", () => {
  it("aggregates payments and interest from every pinned category ID", async () => {
    const cardId = await createAccount("Service Card", TYPE_CREDIT_CARD);
    const mortgageId = await createAccount("Service Mortgage", TYPE_MORTGAGE);

    // One $100 payment in every payment category, on a liability account.
    for (const catId of DEBT_PAYMENT_CATEGORY_IDS) {
      await insertTx(cardId, "2020-06-01", "100.00", catId);
    }
    // One $50 interest accrual in every interest category, on a liability account.
    for (const catId of DEBT_INTEREST_CATEGORY_IDS) {
      await insertTx(mortgageId, "2020-06-15", "-50.00", catId);
    }
    // A non-debt-service category on a liability account — must be excluded.
    await insertTx(cardId, "2020-06-20", "-25.00", 6); // 'Other'

    const result = await getDebtServiceSummary(PERF_START, PERF_END);

    expect(result.totalPayments).toBeCloseTo(
      100 * DEBT_PAYMENT_CATEGORY_IDS.length,
      2
    );
    expect(result.interestAccrued).toBeCloseTo(
      -50 * DEBT_INTEREST_CATEGORY_IDS.length,
      2
    );
    expect(result.principalPaid).toBeCloseTo(
      result.totalPayments + result.interestAccrued,
      2
    );
  });

  it("ignores transactions on non-liability accounts", async () => {
    const checkingId = await createAccount("Service Checking", TYPE_CHECKING);
    // Cat 12 (Mortgage Principle) is in DEBT_PAYMENT_CATEGORY_IDS — but
    // posting it to a checking account should still be filtered out by
    // the account_type_category_id IN (5,6) clause.
    await insertTx(checkingId, "2020-06-01", "100.00", 12);
    await insertTx(checkingId, "2020-06-10", "50.00", 51); // Interest Earned

    const result = await getDebtServiceSummary(PERF_START, PERF_END);

    expect(findDebtServiceAccount(result, checkingId)).toBeUndefined();
  });

  it("groups results by category > account type > account in the sub-table", async () => {
    const cardId = await createAccount("ByAcct Card", TYPE_CREDIT_CARD);
    const mortgageId = await createAccount("ByAcct Mortgage", TYPE_MORTGAGE);
    // Credit-card paydowns post to the liability account as Applied Credit (29).
    await insertTx(cardId, "2020-06-01", "200.00", 29);
    // Mortgage payments split into principal (12) + interest paid (13) on
    // the liability side. Accrued interest (14) is the offsetting accrual.
    await insertTx(mortgageId, "2020-06-05", "700.00", 12);
    await insertTx(mortgageId, "2020-06-05", "800.00", 13);
    await insertTx(mortgageId, "2020-06-15", "-800.00", 14);

    const result = await getDebtServiceSummary(PERF_START, PERF_END);

    const byCard = findDebtServiceAccount(result, cardId);
    const byMortgage = findDebtServiceAccount(result, mortgageId);
    expect(byCard?.totalPayments).toBeCloseTo(200, 2);
    expect(byCard?.interestAccrued).toBeCloseTo(0, 2);
    // Total payment to servicer = principal + interest paid.
    expect(byMortgage?.totalPayments).toBeCloseTo(1500, 2);
    expect(byMortgage?.interestAccrued).toBeCloseTo(-800, 2);
    // Net principal paid = total payments + (negative) accrual = 700.
    expect(byMortgage?.principalPaid).toBeCloseTo(700, 2);

    // Hierarchy parents = sum of children at each level.
    for (const cat of result.categories) {
      const typeSum = cat.accountTypes.reduce(
        (s, t) => s + t.totalPayments,
        0
      );
      expect(typeSum).toBeCloseTo(cat.totalPayments, 2);
      for (const type of cat.accountTypes) {
        const acctSum = type.accounts.reduce(
          (s, a) => s + a.totalPayments,
          0
        );
        expect(acctSum).toBeCloseTo(type.totalPayments, 2);
      }
    }

    // Card lands under Current Liabilities (5); Mortgage under Non-current (6).
    const currentCat = result.categories.find((c) => c.categoryId === 5);
    const nonCurrentCat = result.categories.find((c) => c.categoryId === 6);
    expect(
      currentCat?.accountTypes
        .flatMap((t) => t.accounts)
        .some((a) => a.accountId === cardId)
    ).toBe(true);
    expect(
      nonCurrentCat?.accountTypes
        .flatMap((t) => t.accounts)
        .some((a) => a.accountId === mortgageId)
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// getDebtWaterfall
// ────────────────────────────────────────────────────────────────────

describe("getDebtWaterfall", () => {
  it("reconciles: start + payments + interest + other = end", async () => {
    const mortgageId = await createAccount("WF Mortgage", TYPE_MORTGAGE);

    await insertBalance(mortgageId, PERF_START, "-100000.00");
    await insertBalance(mortgageId, PERF_END, "-95000.00");

    // Liability-side payment legs: principal (12) + interest paid (13).
    await insertTx(mortgageId, "2020-03-01", "5000.00", 12); // Mortgage Principle
    await insertTx(mortgageId, "2020-03-01", "1000.00", 13); // Mortgage Interest
    await insertTx(mortgageId, "2020-06-01", "-1000.00", 14); // Accrued Mortgage Interest

    const result = await getDebtWaterfall(PERF_START, PERF_END);

    expect(result.startBalance).toBeCloseTo(-100000, 2);
    expect(result.endBalance).toBeCloseTo(-95000, 2);
    expect(result.payments).toBeCloseTo(6000, 2);
    expect(result.interestAccrued).toBeCloseTo(-1000, 2);

    // Bridge reconciles exactly — `other` closes the gap.
    const reconciled =
      result.startBalance +
      result.payments +
      result.interestAccrued +
      result.other;
    expect(reconciled).toBeCloseTo(result.endBalance, 2);
  });

  it("returns zeros when there is no liability activity in the range", async () => {
    const result = await getDebtWaterfall("1999-01-01", "1999-12-31");
    expect(result.startBalance).toBe(0);
    expect(result.endBalance).toBe(0);
    expect(result.payments).toBe(0);
    expect(result.interestAccrued).toBe(0);
    expect(result.other).toBe(0);
  });
});
