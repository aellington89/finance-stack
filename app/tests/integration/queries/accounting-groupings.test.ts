import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import {
  getAccountingTimeSeries,
  getAccountingToDateComparison,
  isStandardGrouping,
  type TimeGrouping,
} from "@/lib/queries/accounting";
import { INCOME_TYPE, EXPENSE_TYPE } from "@/lib/constants/reference-ids";

/**
 * Coverage for the grouping matrix (Issue #179).
 *
 * accounting.test.ts asserts the *values* these queries produce, but only
 * through the monthly path. Issue #179 rewrote every grouping — date_trunc's
 * unit, the generate_series step, and the to_char label format all moved from
 * spliced `sql.raw` strings to bound parameters — so all eleven need to be
 * executed, including the six EXTRACT-based ones that take the integer-series
 * branch and the four to_char label formats that only `week`/`quarter`/`year`
 * reach.
 *
 * These assert shape and that the statement runs. A parameter Postgres cannot
 * type, or a format string that lost its quoting, fails here.
 */

const TYPE_CASH = 1;
const CAT_OTHER = 6;

const ALL_GROUPINGS: TimeGrouping[] = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
  "day_of_week",
  "day_of_month",
  "day_of_year",
  "week_of_year",
  "month_of_year",
  "quarter_of_year",
];

const createdAccountIds: number[] = [];
let accountId: number;

beforeEach(async () => {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: "Grouping Matrix Acct", accountTypeId: TYPE_CASH })
    .returning({ accountId: accounts.accountId });
  accountId = row.accountId;
  createdAccountIds.push(accountId);

  // Spread across months and quarters so every bucket expression has something
  // to group, and a to_char label has a real date to format.
  for (const [date, amount, typeId] of [
    ["2021-01-11", "500.00", INCOME_TYPE.id],
    ["2021-02-17", "-120.00", EXPENSE_TYPE.id],
    ["2021-05-03", "800.00", INCOME_TYPE.id],
    ["2021-08-29", "-240.00", EXPENSE_TYPE.id],
    ["2021-11-30", "1000.00", INCOME_TYPE.id],
  ] as const) {
    await db.insert(transactions).values({
      transactionDescription: "grouping probe",
      transactionDate: date,
      accountId,
      amount,
      transactionTypeId: typeId,
      transactionCategoryId: CAT_OTHER,
    });
  }
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

describe("getAccountingTimeSeries across every grouping", () => {
  it.each(ALL_GROUPINGS)("runs and returns numeric buckets for %s", async (timeGrouping) => {
    const points = await getAccountingTimeSeries({
      dateFrom: "2021-01-01",
      dateTo: "2021-12-31",
      accountIds: [accountId],
      timeGrouping,
    });

    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.date).toBeDefined();
      expect(Number.isFinite(point.totalIncome)).toBe(true);
      expect(Number.isFinite(point.totalExpenses)).toBe(true);
      expect(Number.isFinite(point.totalInvestments)).toBe(true);
    }
  });

  it("totals the same across groupings that partition the same window", async () => {
    // day, month and year bucket the same rows differently; the sums must agree.
    const sum = async (timeGrouping: TimeGrouping) =>
      (
        await getAccountingTimeSeries({
          dateFrom: "2021-01-01",
          dateTo: "2021-12-31",
          accountIds: [accountId],
          timeGrouping,
        })
      ).reduce((total, point) => total + point.totalIncome, 0);

    expect(await sum("day")).toBe(2300);
    expect(await sum("month")).toBe(2300);
    expect(await sum("year")).toBe(2300);
  });

  it("bounds the extract-based series to its full integer range", async () => {
    // The generate_series(start, end) branch: 12 months, 4 quarters, 7 weekdays.
    const points = async (timeGrouping: TimeGrouping) =>
      (
        await getAccountingTimeSeries({
          dateFrom: "2021-01-01",
          dateTo: "2021-12-31",
          accountIds: [accountId],
          timeGrouping,
        })
      ).length;

    expect(await points("month_of_year")).toBe(12);
    expect(await points("quarter_of_year")).toBe(4);
    expect(await points("day_of_week")).toBe(7);
  });
});

describe("getAccountingToDateComparison label formats", () => {
  const standard = ALL_GROUPINGS.filter(isStandardGrouping);

  it("covers day, week, month, quarter and year", () => {
    expect(standard).toEqual(["day", "week", "month", "quarter", "year"]);
  });

  it.each(["day", "week", "month", "quarter", "year"] as TimeGrouping[])(
    "renders a non-empty period label for %s",
    async (timeGrouping) => {
      const result = await getAccountingToDateComparison({
        dateFrom: "2021-01-01",
        dateTo: "2021-11-30",
        accountIds: [accountId],
        timeGrouping,
      });

      // to_char's format string is now a bound parameter. If it had kept its
      // wrapping quotes it would render literally, so assert the label is a
      // formatted date rather than the format itself.
      expect(result.currentMonthLabel).not.toBe("");
      expect(result.previousMonthLabel).not.toBe("");
      expect(result.currentMonthLabel).not.toMatch(/YYYY|Mon|DD/);
    }
  );

  it("formats the quarter label with its literal Q prefix", async () => {
    // '"Q"Q YYYY' — the double-quoted literal is the part most at risk from a
    // requoting mistake when the format moved into a parameter.
    const result = await getAccountingToDateComparison({
      dateFrom: "2021-01-01",
      dateTo: "2021-11-30",
      accountIds: [accountId],
      timeGrouping: "quarter",
    });

    expect(result.currentMonthLabel).toMatch(/^Q[1-4] \d{4}$/);
  });

  it("formats the week label as a date range", async () => {
    const result = await getAccountingToDateComparison({
      dateFrom: "2021-01-01",
      dateTo: "2021-11-30",
      accountIds: [accountId],
      timeGrouping: "week",
    });

    expect(result.currentMonthLabel).toMatch(/^\d+\.\d+\.\d{4} - \d+\.\d+\.\d{4}$/);
  });
});
