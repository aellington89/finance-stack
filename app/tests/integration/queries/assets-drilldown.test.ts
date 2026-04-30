import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, accountBalanceHistory } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import {
  getAssetAllocation,
  getAssetPerformance,
  getLiquidityBreakdown,
  getAssetTrendDecomposition,
} from "@/lib/queries/assets-drilldown";

// Test dates — deliberately outside the mock-data seed range (2024-07-01 →
// present), so queries scoped to these dates only return the rows this file
// inserts.
const SNAPSHOT_DATE = "2020-06-30";
const PERF_START = "2020-01-01";
const PERF_END = "2020-12-31";

// Account-type IDs from init-db/seeds/finances-test-mock-data.sql, which are
// stable across test runs.
const TYPE_CASH = 1; // Current Asset, liquid
const TYPE_CHECKING = 2; // Current Asset, liquid
const TYPE_ESCROW = 6; // Restricted Asset, restricted
const TYPE_REAL_ESTATE = 10; // Fixed Asset, illiquid
const TYPE_STOCK = 12; // Investment, semi_liquid
const TYPE_CREDIT_CARD = 15; // Current Liability (should be excluded)

const createdAccountIds: number[] = [];

async function createAccount(
  name: string,
  accountTypeId: number,
  liquidityClass: string | null = null
): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId, liquidityClass })
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

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    await db
      .delete(accountBalanceHistory)
      .where(inArray(accountBalanceHistory.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
    createdAccountIds.length = 0;
  }
});

// ────────────────────────────────────────────────────────────────────
// getAssetAllocation
// ────────────────────────────────────────────────────────────────────

describe("getAssetAllocation", () => {
  it("aggregates asset balances by category and account type", async () => {
    const cashId = await createAccount("Alloc Cash", TYPE_CASH);
    const checkingId = await createAccount("Alloc Checking", TYPE_CHECKING);
    const escrowId = await createAccount("Alloc Escrow", TYPE_ESCROW);
    const stockId = await createAccount("Alloc Stock", TYPE_STOCK);
    const realEstateId = await createAccount("Alloc Real Estate", TYPE_REAL_ESTATE);
    const cardId = await createAccount("Alloc Card", TYPE_CREDIT_CARD);

    await insertBalance(cashId, SNAPSHOT_DATE, "1000.00");
    await insertBalance(checkingId, SNAPSHOT_DATE, "2000.00");
    await insertBalance(escrowId, SNAPSHOT_DATE, "500.00");
    await insertBalance(stockId, SNAPSHOT_DATE, "5000.00");
    await insertBalance(realEstateId, SNAPSHOT_DATE, "200000.00");
    await insertBalance(cardId, SNAPSHOT_DATE, "-300.00");

    const result = await getAssetAllocation(SNAPSHOT_DATE);

    // Total excludes the liability (card).
    expect(result.totalAssets).toBe(1000 + 2000 + 500 + 5000 + 200000);

    // Only asset categories (1..4) are present.
    for (const cat of result.byCategory) {
      expect([1, 2, 3, 4]).toContain(cat.categoryId);
    }

    // Each category's children values sum to the parent value.
    for (const cat of result.byCategory) {
      const childSum = cat.children.reduce((s, c) => s + c.value, 0);
      expect(childSum).toBeCloseTo(cat.value, 2);
    }

    // Percents sum to 100 (allowing rounding slack).
    const catPercentSum = result.byCategory.reduce(
      (s, c) => s + c.percentOfTotal,
      0
    );
    expect(catPercentSum).toBeGreaterThan(99.5);
    expect(catPercentSum).toBeLessThan(100.5);

    // Cat 1 (Current Asset) should equal cash + checking.
    const currentAsset = result.byCategory.find((c) => c.categoryId === 1);
    expect(currentAsset?.value).toBe(3000);

    // Cat 3 (Fixed Asset) should include real estate.
    const fixedAsset = result.byCategory.find((c) => c.categoryId === 3);
    expect(fixedAsset?.value).toBe(200000);
  });

  it("excludes liability categories entirely", async () => {
    const cashId = await createAccount("Exclude Cash", TYPE_CASH);
    const cardId = await createAccount("Exclude Card", TYPE_CREDIT_CARD);
    await insertBalance(cashId, SNAPSHOT_DATE, "100.00");
    await insertBalance(cardId, SNAPSHOT_DATE, "-100.00");

    const result = await getAssetAllocation(SNAPSHOT_DATE);

    // No category 5 or 6 appears.
    for (const cat of result.byCategory) {
      expect(cat.categoryId).not.toBe(5);
      expect(cat.categoryId).not.toBe(6);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// getAssetPerformance
// ────────────────────────────────────────────────────────────────────

describe("getAssetPerformance", () => {
  it("returns hierarchical change with category = sum(type) = sum(account)", async () => {
    const cashId = await createAccount("Perf Cash", TYPE_CASH);
    const stockId = await createAccount("Perf Stock", TYPE_STOCK);

    await insertBalance(cashId, PERF_START, "1000.00");
    await insertBalance(cashId, PERF_END, "1500.00");
    await insertBalance(stockId, PERF_START, "10000.00");
    await insertBalance(stockId, PERF_END, "12000.00");

    const result = await getAssetPerformance(PERF_START, PERF_END);

    expect(result.totalCurrentValue).toBe(1500 + 12000);
    expect(result.totalStartValue).toBe(1000 + 10000);
    expect(result.totalChange).toBe(
      result.totalCurrentValue - result.totalStartValue
    );

    for (const cat of result.categories) {
      expect(cat.change).toBeCloseTo(cat.currentValue - cat.startValue, 2);
      const typeSum = cat.accountTypes.reduce((s, t) => s + t.currentValue, 0);
      expect(typeSum).toBeCloseTo(cat.currentValue, 2);
      const typeStartSum = cat.accountTypes.reduce(
        (s, t) => s + t.startValue,
        0
      );
      expect(typeStartSum).toBeCloseTo(cat.startValue, 2);

      for (const type of cat.accountTypes) {
        const acctSum = type.accounts.reduce((s, a) => s + a.currentValue, 0);
        expect(acctSum).toBeCloseTo(type.currentValue, 2);
        const acctStartSum = type.accounts.reduce(
          (s, a) => s + a.startValue,
          0
        );
        expect(acctStartSum).toBeCloseTo(type.startValue, 2);
      }
    }
  });

  it("scopes to asset categories only", async () => {
    const cashId = await createAccount("PerfScope Cash", TYPE_CASH);
    const cardId = await createAccount("PerfScope Card", TYPE_CREDIT_CARD);

    await insertBalance(cashId, PERF_START, "100.00");
    await insertBalance(cashId, PERF_END, "200.00");
    await insertBalance(cardId, PERF_START, "-50.00");
    await insertBalance(cardId, PERF_END, "-25.00");

    const result = await getAssetPerformance(PERF_START, PERF_END);

    for (const cat of result.categories) {
      expect([1, 2, 3, 4]).toContain(cat.categoryId);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// getLiquidityBreakdown
// ────────────────────────────────────────────────────────────────────

describe("getLiquidityBreakdown", () => {
  it("buckets assets by effective liquidity class (type default)", async () => {
    const cashId = await createAccount("Liq Cash", TYPE_CASH); // liquid
    const stockId = await createAccount("Liq Stock", TYPE_STOCK); // semi_liquid
    const realEstateId = await createAccount("Liq Real Estate", TYPE_REAL_ESTATE); // illiquid
    const escrowId = await createAccount("Liq Escrow", TYPE_ESCROW); // restricted

    await insertBalance(cashId, SNAPSHOT_DATE, "1000.00");
    await insertBalance(stockId, SNAPSHOT_DATE, "5000.00");
    await insertBalance(realEstateId, SNAPSHOT_DATE, "100000.00");
    await insertBalance(escrowId, SNAPSHOT_DATE, "500.00");

    const result = await getLiquidityBreakdown(SNAPSHOT_DATE);

    expect(result.total).toBe(1000 + 5000 + 100000 + 500);

    const sumOfBuckets = result.classes.reduce((s, c) => s + c.value, 0);
    expect(sumOfBuckets).toBeCloseTo(result.total, 2);

    const byClass = (k: string) =>
      result.classes.find((c) => c.liquidityClass === k)?.value ?? 0;

    expect(byClass("liquid")).toBe(1000);
    expect(byClass("semi_liquid")).toBe(5000);
    expect(byClass("illiquid")).toBe(100000);
    expect(byClass("restricted")).toBe(500);
  });

  it("respects per-account liquidity override (COALESCE)", async () => {
    // Real-estate account (type default = illiquid) overridden to liquid.
    const overriddenId = await createAccount(
      "Liq Override",
      TYPE_REAL_ESTATE,
      "liquid"
    );
    await insertBalance(overriddenId, SNAPSHOT_DATE, "75000.00");

    const result = await getLiquidityBreakdown(SNAPSHOT_DATE);

    const liquidTotal =
      result.classes.find((c) => c.liquidityClass === "liquid")?.value ?? 0;
    const illiquidTotal =
      result.classes.find((c) => c.liquidityClass === "illiquid")?.value ?? 0;

    // Overridden real-estate counts against liquid, NOT illiquid.
    expect(liquidTotal).toBeGreaterThanOrEqual(75000);
    expect(illiquidTotal).toBeLessThan(75000);
  });

  it("bucket percents sum to 100", async () => {
    const cashId = await createAccount("LiqPct Cash", TYPE_CASH);
    const stockId = await createAccount("LiqPct Stock", TYPE_STOCK);
    await insertBalance(cashId, SNAPSHOT_DATE, "2500.00");
    await insertBalance(stockId, SNAPSHOT_DATE, "7500.00");

    const result = await getLiquidityBreakdown(SNAPSHOT_DATE);

    const pctSum = result.classes.reduce((s, c) => s + c.percent, 0);
    expect(pctSum).toBeGreaterThan(99.5);
    expect(pctSum).toBeLessThan(100.5);
  });
});

// ────────────────────────────────────────────────────────────────────
// getAssetTrendDecomposition
// ────────────────────────────────────────────────────────────────────

describe("getAssetTrendDecomposition", () => {
  it("returns rows only for asset categories within the date range", async () => {
    const cashId = await createAccount("Trend Cash", TYPE_CASH);
    const stockId = await createAccount("Trend Stock", TYPE_STOCK);
    const cardId = await createAccount("Trend Card", TYPE_CREDIT_CARD);

    await insertBalance(cashId, PERF_START, "100.00");
    await insertBalance(cashId, PERF_END, "200.00");
    await insertBalance(stockId, PERF_START, "1000.00");
    await insertBalance(stockId, PERF_END, "2000.00");
    await insertBalance(cardId, PERF_START, "-10.00");
    await insertBalance(cardId, PERF_END, "-5.00");

    const rows = await getAssetTrendDecomposition(PERF_START, PERF_END);

    // No liability rows.
    for (const r of rows) {
      expect([1, 2, 3, 4]).toContain(r.categoryId);
      expect(r.date >= PERF_START && r.date <= PERF_END).toBe(true);
    }

    // Our four test balance rows are all present.
    const myIds = new Set([cashId, stockId]);
    const mine = rows.filter((r) => myIds.has(r.accountId));
    expect(mine).toHaveLength(4);
  });

  it("respects dateFrom/dateTo bounds", async () => {
    const cashId = await createAccount("Bounds Cash", TYPE_CASH);
    await insertBalance(cashId, "2019-01-01", "50.00");
    await insertBalance(cashId, "2020-06-30", "100.00");
    await insertBalance(cashId, "2021-12-31", "150.00");

    const rows = await getAssetTrendDecomposition("2020-01-01", "2020-12-31");
    const mine = rows.filter((r) => r.accountId === cashId);

    expect(mine).toHaveLength(1);
    expect(mine[0].date).toBe("2020-06-30");
  });
});
