import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  accounts,
  accountBalanceHistory,
  balanceTransfers,
  transactionCategories,
  transactions,
} from "@/drizzle/schema";
import { eq, inArray, or } from "drizzle-orm";
import { rebuildAccountBalance } from "@/lib/queries/rebuild-balance";
import {
  getActiveBalanceTransfers,
  getBalanceTransferCandidates,
  getBalanceTransfersForAccount,
} from "@/lib/queries/balance-transfers";
import {
  getDebtServiceSummary,
  getDebtWaterfall,
  getLiabilityAllocation,
  getLiabilityPerformance,
} from "@/lib/queries/liabilities-drilldown";
import { getAccountingPeriodTotals } from "@/lib/queries/accounting";
import { DAYS_PER_MONTH } from "@/lib/queries/balance-transfer-payoff";

// Issue #417. Dated in 2020, outside the mock-data window, so every query here
// sees only the rows this file inserts. Balances come from real transactions
// through rebuildAccountBalance(), so the paces are measured the way the page
// measures them. All figures are synthetic.

const TYPE_CHECKING = 2; // Current Asset
const TYPE_CREDIT_CARD = 15; // Current Liability
const INTERNAL_TRANSFER = 1;
const EXPENSE = 2;

const POSTING_DATE = "2020-03-01";
const FEE_DATE = "2020-03-04";
const PROMO_END = "2021-09-01";
const RANGE_FROM = "2020-01-01";
const AS_OF = "2020-12-31";

const createdAccountIds: number[] = [];
const createdTxIds: number[] = [];
const createdCategoryIds: number[] = [];

async function createAccount(name: string, accountTypeId: number): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

async function insertTx(fields: {
  accountId: number;
  date: string;
  amount: string;
  categoryId: number;
  typeId?: number;
  relatedAccountId?: number;
  description?: string;
}): Promise<number> {
  const [row] = await db
    .insert(transactions)
    .values({
      transactionDescription: fields.description ?? "bt test",
      transactionDate: fields.date,
      accountId: fields.accountId,
      amount: fields.amount,
      relatedAccountId: fields.relatedAccountId ?? null,
      transactionTypeId: fields.typeId ?? EXPENSE,
      transactionCategoryId: fields.categoryId,
    })
    .returning({ transactionId: transactions.transactionId });
  createdTxIds.push(row.transactionId);
  return row.transactionId;
}

interface Scenario {
  source: number;
  card: number;
  revolving: number;
  checking: number;
  posting: number;
  fee: number;
  category: number;
}

/**
 * Card A (source) transfers $3,000 to card B on Mar 1, 2020, with a $90 fee
 * three days later and $250 monthly payments from Apr 1. Card C revolves on
 * the same account type, so the type has both kinds of debt.
 */
async function buildScenario(link = true): Promise<Scenario> {
  const [cat] = await db
    .insert(transactionCategories)
    .values({ transactionCategory: `BT test category ${Date.now()}` })
    .returning({ id: transactionCategories.transactionCategoryId });
  createdCategoryIds.push(cat.id);
  const category = cat.id;

  const source = await createAccount("BT Test - Card A", TYPE_CREDIT_CARD);
  const card = await createAccount("BT Test - Card B", TYPE_CREDIT_CARD);
  const revolving = await createAccount("BT Test - Card C", TYPE_CREDIT_CARD);
  const checking = await createAccount("BT Test - Checking", TYPE_CHECKING);

  await insertTx({ accountId: source, date: "2020-01-10", amount: "-4000.00", categoryId: category });
  await insertTx({ accountId: card, date: "2020-01-10", amount: "-500.00", categoryId: category });
  await insertTx({ accountId: revolving, date: "2020-01-10", amount: "-700.00", categoryId: category });
  await insertTx({ accountId: checking, date: "2020-01-10", amount: "9000.00", categoryId: category });

  await insertTx({
    accountId: source, date: POSTING_DATE, amount: "3000.00", categoryId: category,
    typeId: INTERNAL_TRANSFER, relatedAccountId: card,
  });
  const posting = await insertTx({
    accountId: card, date: POSTING_DATE, amount: "-3000.00", categoryId: category,
    typeId: INTERNAL_TRANSFER, relatedAccountId: source, description: "Balance transfer",
  });
  const fee = await insertTx({
    accountId: card, date: FEE_DATE, amount: "-90.00", categoryId: category,
    description: "Balance transfer fee",
  });

  for (let m = 4; m <= 12; m++) {
    const date = `2020-${String(m).padStart(2, "0")}-01`;
    await insertTx({ accountId: checking, date, amount: "-250.00", categoryId: category, typeId: INTERNAL_TRANSFER, relatedAccountId: card });
    await insertTx({ accountId: card, date, amount: "250.00", categoryId: category, typeId: INTERNAL_TRANSFER, relatedAccountId: checking });
  }

  for (const id of [source, card, revolving, checking]) {
    await rebuildAccountBalance(db, id);
  }

  if (link) await linkTransfer(posting, fee);
  return { source, card, revolving, checking, posting, fee, category };
}

async function linkTransfer(posting: number, fee: number | null, promoEndDate = PROMO_END, promoApr = "0") {
  const [row] = await db
    .insert(balanceTransfers)
    .values({ transferTransactionId: posting, feeTransactionId: fee, promoEndDate, promoApr })
    .returning({ id: balanceTransfers.balanceTransferId });
  return row.id;
}

/**
 * Adds a $600 transfer to card B on Apr 15, 2020, on a promo that ends on
 * Jan 15, 2021, before the scenario's own. Payments reach it first, once the
 * card's $500 of earlier debt is cleared (by May 1), so the Jun, Jul and Aug
 * payments pay it off on Aug 1. The rest of that payment ($150) and the four
 * after it reach the scenario's transfer, which is left with
 * 3,090 - 1,150 = 1,940: all of the card's debt.
 */
async function addPaidOffTransfer(s: Scenario) {
  const posting = await insertTx({
    accountId: s.card, date: "2020-04-15", amount: "-600.00", categoryId: s.category,
    typeId: INTERNAL_TRANSFER, relatedAccountId: s.source,
  });
  await rebuild(s.card);
  const paidOff = await linkTransfer(posting, null, "2021-01-15");
  const [{ id: transferId }] = await db
    .select({ id: balanceTransfers.balanceTransferId })
    .from(balanceTransfers)
    .where(eq(balanceTransfers.transferTransactionId, s.posting));
  return { ...s, paidOff, transferId };
}

async function rebuild(...ids: number[]) {
  for (const id of ids) await rebuildAccountBalance(db, id);
}

afterEach(async () => {
  if (createdTxIds.length > 0) {
    // Transfers first: the posting's FK is RESTRICT.
    await db
      .delete(balanceTransfers)
      .where(
        or(
          inArray(balanceTransfers.transferTransactionId, createdTxIds),
          inArray(balanceTransfers.feeTransactionId, createdTxIds)
        )
      );
    await db.delete(transactions).where(inArray(transactions.transactionId, createdTxIds));
    createdTxIds.length = 0;
  }
  if (createdAccountIds.length > 0) {
    await db.delete(accountBalanceHistory).where(inArray(accountBalanceHistory.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
    createdAccountIds.length = 0;
  }
  if (createdCategoryIds.length > 0) {
    await db
      .delete(transactionCategories)
      .where(inArray(transactionCategories.transactionCategoryId, createdCategoryIds));
    createdCategoryIds.length = 0;
  }
});

const onCard = async (card: number, dateFrom: string, dateTo?: string) =>
  (await getActiveBalanceTransfers(dateFrom, dateTo)).filter((t) => t.accountId === card);

// ────────────────────────────────────────────────────────────────────
// getActiveBalanceTransfers
// ────────────────────────────────────────────────────────────────────

describe("getActiveBalanceTransfers", () => {
  it("reads the card, amount, source and start date from the posting", async () => {
    const s = await buildScenario();
    const [row] = await onCard(s.card, RANGE_FROM, AS_OF);

    expect(row).toBeDefined();
    expect(row.accountName).toBe("BT Test - Card B");
    expect(row.asOf).toBe(AS_OF);
    expect(row.transfer).toMatchObject({
      sourceAccountName: "BT Test - Card A",
      postingDate: POSTING_DATE,
      transferredAmount: 3000,
      feeAmount: 90,
      promoEndDate: PROMO_END,
      promoApr: 0,
    });
    // The card owes -500 - 3000 - 90 + 9 × 250 = 1,340. The $500 owed before
    // the transfer was cleared by the first two payments, so all of it is
    // left on the transfer.
    expect(row.owed).toBe(1340);
    expect(row.aheadOfIt).toBe(0);
    expect(row.monthsRemaining).toBe(9);
  });

  it("measures the 3-month pace from balance history, leaving out the linked posting and fee", async () => {
    const s = await buildScenario();
    const [row] = await onCard(s.card, RANGE_FROM, AS_OF);

    // Trailing 3 months: Sep 30 → Dec 31 (92 days), three $250 payments.
    expect(row.threeMonthPace).toBeCloseTo((750 / 92) * DAYS_PER_MONTH, 6);
    // Range: from the posting (Mar 1) → Dec 31, 305 days. Nine payments, and
    // the fee is taken back out, so it reads as paydown only.
    expect(row.rangePace).toBeCloseTo((2250 / 305) * DAYS_PER_MONTH, 6);
  });

  it("counts the posting day and not the end day", async () => {
    const s = await buildScenario();

    expect(await onCard(s.card, RANGE_FROM, "2020-02-29")).toHaveLength(0);
    const [onPostingDay] = await onCard(s.card, RANGE_FROM, POSTING_DATE);
    expect(onPostingDay).toBeDefined();
    // Too new to project on day one.
    expect(onPostingDay.status).toEqual({ kind: "too_new" });

    expect(await onCard(s.card, RANGE_FROM, "2021-08-31")).toHaveLength(1);
    expect(await onCard(s.card, RANGE_FROM, PROMO_END)).toHaveLength(0);
  });

  it("follows edits to the posting's amount and date", async () => {
    const s = await buildScenario();
    await db
      .update(transactions)
      .set({ amount: "-3500.00", transactionDate: "2020-05-01" })
      .where(eq(transactions.transactionId, s.posting));
    await rebuild(s.card);

    expect(await onCard(s.card, RANGE_FROM, "2020-04-15")).toHaveLength(0);
    const [row] = await onCard(s.card, RANGE_FROM, AS_OF);
    expect(row.transfer.transferredAmount).toBe(3500);
    expect(row.transfer.postingDate).toBe("2020-05-01");
  });

  it("drops a posting moved to an asset account", async () => {
    const s = await buildScenario();
    await db
      .update(transactions)
      .set({ accountId: s.checking })
      .where(eq(transactions.transactionId, s.posting));
    await rebuild(s.card, s.checking);

    const all = await getActiveBalanceTransfers(RANGE_FROM, AS_OF);
    expect(all.find((t) => t.accountId === s.card)).toBeUndefined();
    expect(all.find((t) => t.accountId === s.checking)).toBeUndefined();
  });

  it("drops a posting edited into a credit", async () => {
    const s = await buildScenario();
    await db
      .update(transactions)
      .set({ amount: "3000.00" })
      .where(eq(transactions.transactionId, s.posting));
    await rebuild(s.card);

    expect(await onCard(s.card, RANGE_FROM, AS_OF)).toHaveLength(0);
  });

  it("reads a fee moved to another account as unlinked", async () => {
    const s = await buildScenario();
    await db
      .update(transactions)
      .set({ accountId: s.revolving })
      .where(eq(transactions.transactionId, s.fee));
    await rebuild(s.card, s.revolving);

    const [row] = await onCard(s.card, RANGE_FROM, AS_OF);
    expect(row.transfer.feeAmount).toBeNull();
  });

  it("shows External when the posting has no related account", async () => {
    const s = await buildScenario();
    await db
      .update(transactions)
      .set({ relatedAccountId: null })
      .where(eq(transactions.transactionId, s.posting));

    const [row] = await onCard(s.card, RANGE_FROM, AS_OF);
    expect(row.transfer.sourceAccountName).toBeNull();
  });

  it("gives each of a card's overlapping transfers its own row, splitting the balance between them", async () => {
    const s = await buildScenario();
    // $800 more on Jun 1, the same day as a $250 payment, on a longer promo.
    const second = await insertTx({
      accountId: s.card, date: "2020-06-01", amount: "-800.00", categoryId: s.category,
      typeId: INTERNAL_TRANSFER, relatedAccountId: s.source,
    });
    await rebuild(s.card);
    await linkTransfer(second, null, "2022-06-01");

    const rows = await onCard(s.card, RANGE_FROM, AS_OF);
    // The first transfer ends sooner, so the payments after Jun 1 all reach
    // it: 3,090 - 250 (the Jun 1 payment, once the $500 was cleared) - 6 × 250.
    expect(rows.map((r) => [r.transfer.promoEndDate, r.owed, r.aheadOfIt])).toEqual([
      [PROMO_END, 1340, 0],
      ["2022-06-01", 800, 1340],
    ]);
    // Pace is the card's, on both rows.
    expect(rows[0].threeMonthPace).toBe(rows[1].threeMonthPace);
  });

  it("reads an earlier-ending transfer as paid off once the payments have cleared it", async () => {
    const s = await addPaidOffTransfer(await buildScenario());
    const rows = await onCard(s.card, RANGE_FROM, AS_OF);

    expect(rows.map((r) => r.transfer.balanceTransferId)).toEqual([s.paidOff, s.transferId]);
    expect(rows[0]).toMatchObject({
      owed: 0,
      requiredPerMonth: null,
      threeMonthPace: null,
      projectedAtExpiry: null,
      status: { kind: "paid_off" },
    });
    // It no longer sets the deadline: the other transfer is judged on its own
    // end date, nine months out, rather than "Expires in 15 days".
    expect(rows[1].owed).toBe(1940);
    expect(rows[1].monthsRemaining).toBe(9);
    expect(rows[1].requiredPerMonth).toBeCloseTo(1940 / 9, 10);
    expect(rows[1].status.kind).not.toBe("expiring");
  });
});

// ────────────────────────────────────────────────────────────────────
// The debt-mix split and the performance badge
// ────────────────────────────────────────────────────────────────────

describe("getLiabilityAllocation promo split", () => {
  const creditCardType = async (asOf: string) => {
    const data = await getLiabilityAllocation(asOf);
    return data.byCategory
      .flatMap((c) => c.children)
      .find((c) => c.accountTypeId === TYPE_CREDIT_CARD);
  };

  it("reports the promotional share of a type with an active promo", async () => {
    await buildScenario();
    const type = await creditCardType(AS_OF);

    // A: -4000 + 3000; B: -1340; C: -700.
    expect(type?.value).toBe(-3040);
    expect(type?.hasActivePromo).toBe(true);
    expect(type?.promoValue).toBe(-1340);
  });

  it("reverts to revolving once the promo has ended", async () => {
    await buildScenario();
    const type = await creditCardType(PROMO_END);

    expect(type?.value).toBe(-3040);
    expect(type).not.toHaveProperty("hasActivePromo");
    expect(type).not.toHaveProperty("promoValue");
  });

  it("does not split before the posting date", async () => {
    await buildScenario();
    const type = await creditCardType("2020-02-29");
    expect(type).not.toHaveProperty("hasActivePromo");
  });
});

describe("getLiabilityPerformance activePromo", () => {
  const accountRow = async (dateFrom: string, dateTo: string, accountId: number) => {
    const data = await getLiabilityPerformance(dateFrom, dateTo);
    return data.categories
      .flatMap((c) => c.accountTypes)
      .flatMap((t) => t.accounts)
      .find((a) => a.accountId === accountId);
  };

  it("badges the promotional card only", async () => {
    const s = await buildScenario();

    expect((await accountRow("2020-06-30", AS_OF, s.card))?.activePromo).toEqual({
      apr: 0,
      endDate: PROMO_END,
    });
    expect(await accountRow("2020-06-30", AS_OF, s.revolving)).not.toHaveProperty(
      "activePromo"
    );
  });

  it("carries a non-zero promo APR", async () => {
    const s = await buildScenario(false);
    await linkTransfer(s.posting, s.fee, PROMO_END, "3.990");

    expect((await accountRow("2020-06-30", AS_OF, s.card))?.activePromo).toEqual({
      apr: 3.99,
      endDate: PROMO_END,
    });
  });

  it("drops the badge once the promo has ended", async () => {
    const s = await buildScenario();
    expect(await accountRow("2021-06-30", PROMO_END, s.card)).not.toHaveProperty(
      "activePromo"
    );
  });
});

describe("linking a transfer", () => {
  it("changes no balance, expense or Debt Service total", async () => {
    const s = await buildScenario(false);

    const snapshot = async () => ({
      allocation: (await getLiabilityAllocation(AS_OF)).totalLiabilities,
      debtService: await getDebtServiceSummary(RANGE_FROM, AS_OF),
      waterfall: await getDebtWaterfall(RANGE_FROM, AS_OF),
      expenses: (await getAccountingPeriodTotals({ dateFrom: RANGE_FROM, dateTo: AS_OF }))
        .totalExpenses,
      balances: await db
        .select()
        .from(accountBalanceHistory)
        .where(eq(accountBalanceHistory.accountId, s.card)),
    });

    const before = await snapshot();
    await linkTransfer(s.posting, s.fee);
    const after = await snapshot();

    expect(after).toEqual(before);
  });
});

// ────────────────────────────────────────────────────────────────────
// Constraints
// ────────────────────────────────────────────────────────────────────

describe("balance_transfers constraints", () => {
  it("refuses deleting a linked posting (RESTRICT)", async () => {
    const s = await buildScenario();
    // RESTRICT raises restrict_violation (23001), not the foreign_key_violation
    // (23503) a NO ACTION key would. deleteTransaction() refuses before it gets
    // here; this is the backstop for any other writer.
    await expect(
      db.delete(transactions).where(eq(transactions.transactionId, s.posting))
    ).rejects.toMatchObject({ cause: { code: "23001" } });
  });

  it("unlinks a deleted fee (SET NULL) and keeps the transfer", async () => {
    const s = await buildScenario();
    await db.delete(transactions).where(eq(transactions.transactionId, s.fee));
    createdTxIds.splice(createdTxIds.indexOf(s.fee), 1);
    await rebuild(s.card);

    const [row] = await db
      .select()
      .from(balanceTransfers)
      .where(eq(balanceTransfers.transferTransactionId, s.posting));
    expect(row.feeTransactionId).toBeNull();
    const [tracked] = await onCard(s.card, RANGE_FROM, AS_OF);
    expect(tracked.transfer.feeAmount).toBeNull();
  });

  it("refuses linking a posting twice", async () => {
    const s = await buildScenario();
    await expect(linkTransfer(s.posting, null)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });

  it("refuses a fee that is the posting itself", async () => {
    const s = await buildScenario(false);
    await expect(linkTransfer(s.posting, s.posting)).rejects.toMatchObject({
      cause: { code: "23514" },
    });
  });

  it("refuses an APR outside 0–100", async () => {
    const s = await buildScenario(false);
    await expect(linkTransfer(s.posting, null, PROMO_END, "100.001")).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    await expect(linkTransfer(s.posting, null, PROMO_END, "-1")).rejects.toMatchObject({
      cause: { code: "23514" },
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// The edit page's reads
// ────────────────────────────────────────────────────────────────────

describe("getBalanceTransfersForAccount", () => {
  it("lists the account's transfers with posting and fee facts", async () => {
    const s = await buildScenario();
    const [bt] = await getBalanceTransfersForAccount(s.card);

    expect(bt).toMatchObject({
      transferTransactionId: s.posting,
      postingDate: POSTING_DATE,
      postingDescription: "Balance transfer",
      postingAmount: -3000,
      sourceAccountName: "BT Test - Card A",
      feeTransactionId: s.fee,
      feeAmount: -90,
      promoEndDate: PROMO_END,
      promoApr: 0,
      // A 2020–21 promo is long over.
      isActive: false,
    });
    expect(await getBalanceTransfersForAccount(s.revolving)).toEqual([]);
  });
});

describe("getBalanceTransferCandidates", () => {
  it("offers the card's debt-adding transactions, marking linked ones", async () => {
    const s = await buildScenario();
    const candidates = await getBalanceTransferCandidates(s.card);
    const ids = candidates.map((c) => c.transactionId);

    // The posting is a transfer type, so it is offered at any age, and the fee
    // is within 60 days after it. The 2020 opening purchase is neither.
    expect(ids).toContain(s.posting);
    expect(ids).toContain(s.fee);
    expect(candidates.every((c) => c.amount < 0)).toBe(true);
    expect(candidates.find((c) => c.transactionId === s.posting)?.linkedBalanceTransferId).not.toBeNull();
    expect(candidates).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────
// The Finances_Test fixture
// ────────────────────────────────────────────────────────────────────

describe("the Finances_Test fixture transfer", () => {
  const DISCOVER = 9;

  beforeEach(async () => {
    // Today's carry-forward row may not exist yet; the page ensures it.
    await rebuildAccountBalance(db, DISCOVER);
  });

  it("is active today, with its posting and fee linked", async () => {
    const [row] = await onCard(DISCOVER, "2020-01-01");

    expect(row).toBeDefined();
    expect(row.transfer).toMatchObject({
      sourceAccountName: "Test Credit Card - Visa",
      transferredAmount: 1200,
      feeAmount: 36,
      promoApr: 0,
    });
  });

  it("splits the Credit Card tile today", async () => {
    const data = await getLiabilityAllocation();
    const type = data.byCategory
      .flatMap((c) => c.children)
      .find((c) => c.accountTypeId === TYPE_CREDIT_CARD);
    expect(type?.hasActivePromo).toBe(true);
    expect(type?.promoValue).toBeLessThan(0);
    expect(type?.promoValue).toBeGreaterThan(type!.value);
  });
});
