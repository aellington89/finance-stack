import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  accounts,
  accountBalanceHistory,
  balanceTransfers,
  transactions,
} from "@/drizzle/schema";
import { eq, inArray, or } from "drizzle-orm";
import {
  createBalanceTransfer,
  deleteBalanceTransfer,
  updateBalanceTransfer,
} from "@/lib/actions/balance-transfer";
import { deleteTransaction } from "@/lib/actions/transaction";
import type { ActionState } from "@/lib/actions/utils";

// Issue #417. The actions run against Finances_Test with the session
// vitest-setup.ts installs. Every account and transaction here is created by
// the test and dated in 2020; all figures are synthetic.

const TYPE_CHECKING = 2; // Current Asset
const TYPE_CREDIT_CARD = 15; // Current Liability
const TYPE_MORTGAGE = 17; // Non-current Liability
const INTERNAL_TRANSFER = 1;
const EXPENSE = 2;
const CATEGORY = 6; // 'Other', the one app-owned category

const emptyState: ActionState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) fd.append(key, val);
  return fd;
}

let createdAccountIds: number[];

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
  amount: string,
  date: string,
  typeId = EXPENSE
): Promise<number> {
  const [row] = await db
    .insert(transactions)
    .values({
      transactionDescription: "bt action test",
      transactionDate: date,
      accountId,
      amount,
      transactionTypeId: typeId,
      transactionCategoryId: CATEGORY,
    })
    .returning({ transactionId: transactions.transactionId });
  return row.transactionId;
}

let card: number;
let posting: number;
let fee: number;

beforeEach(async () => {
  createdAccountIds = [];
  card = await createAccount("BT Action Test - Card", TYPE_CREDIT_CARD);
  posting = await insertTx(card, "-3000.00", "2020-03-01", INTERNAL_TRANSFER);
  fee = await insertTx(card, "-90.00", "2020-03-04");
});

afterEach(async () => {
  const txIds = (
    await db
      .select({ id: transactions.transactionId })
      .from(transactions)
      .where(inArray(transactions.accountId, createdAccountIds))
  ).map((r) => r.id);
  if (txIds.length > 0) {
    await db
      .delete(balanceTransfers)
      .where(
        or(
          inArray(balanceTransfers.transferTransactionId, txIds),
          inArray(balanceTransfers.feeTransactionId, txIds)
        )
      );
  }
  await db.delete(transactions).where(inArray(transactions.accountId, createdAccountIds));
  await db
    .delete(accountBalanceHistory)
    .where(inArray(accountBalanceHistory.accountId, createdAccountIds));
  await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
});

const form = (overrides: Record<string, string> = {}) =>
  makeFormData({
    accountId: String(card),
    transferTransactionId: String(posting),
    feeTransactionId: String(fee),
    promoEndDate: "2021-09-01",
    promoApr: "0",
    ...overrides,
  });

async function transfersOn(postingId: number) {
  return db
    .select()
    .from(balanceTransfers)
    .where(eq(balanceTransfers.transferTransactionId, postingId));
}

async function create(overrides: Record<string, string> = {}) {
  return createBalanceTransfer(emptyState, form(overrides));
}

// ─── createBalanceTransfer ───────────────────────────────────────────────────

describe("createBalanceTransfer", () => {
  it("links an existing posting and fee, typing only the end date and APR", async () => {
    const result = await create({ promoApr: "3.99" });
    expect(result).toEqual({ success: true, errors: {}, message: "Balance transfer saved" });

    const [row] = await transfersOn(posting);
    expect(row).toMatchObject({
      transferTransactionId: posting,
      feeTransactionId: fee,
      promoEndDate: "2021-09-01",
      promoApr: "3.990",
    });
  });

  it("records a transfer with no separate fee", async () => {
    const result = await create({ feeTransactionId: "" });
    expect(result.success).toBe(true);
    const [row] = await transfersOn(posting);
    expect(row.feeTransactionId).toBeNull();
  });

  it("accepts a non-current liability", async () => {
    const loan = await createAccount("BT Action Test - Loan", TYPE_MORTGAGE);
    const loanPosting = await insertTx(loan, "-1000.00", "2020-03-01");
    const result = await create({
      accountId: String(loan),
      transferTransactionId: String(loanPosting),
      feeTransactionId: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an asset account", async () => {
    const checking = await createAccount("BT Action Test - Checking", TYPE_CHECKING);
    const outflow = await insertTx(checking, "-3000.00", "2020-03-01");
    const result = await create({
      accountId: String(checking),
      transferTransactionId: String(outflow),
      feeTransactionId: "",
    });
    expect(result).toMatchObject({
      success: false,
      message: "Balance transfers can only be recorded on liability accounts.",
    });
    expect(await transfersOn(outflow)).toEqual([]);
  });

  it("rejects a posting on another account", async () => {
    const other = await createAccount("BT Action Test - Other Card", TYPE_CREDIT_CARD);
    const elsewhere = await insertTx(other, "-500.00", "2020-03-01");
    const result = await create({ transferTransactionId: String(elsewhere) });
    expect(result.errors.transferTransactionId).toEqual(["Pick a transaction on this account."]);
  });

  it("rejects a posting that doesn't add debt", async () => {
    const payment = await insertTx(card, "250.00", "2020-04-01");
    const result = await create({ transferTransactionId: String(payment) });
    expect(result.errors.transferTransactionId).toEqual([
      "Pick a transaction that added debt to this card. A transfer's posting has a negative amount.",
    ]);
  });

  it("rejects a posting already linked to another transfer", async () => {
    expect((await create()).success).toBe(true);
    const result = await create({ feeTransactionId: "" });
    expect(result.errors.transferTransactionId).toEqual([
      "That transaction is already linked to another balance transfer.",
    ]);
  });

  it("rejects a posting already linked as another transfer's fee", async () => {
    const other = await insertTx(card, "-1000.00", "2020-02-01", INTERNAL_TRANSFER);
    expect(
      (await create({ transferTransactionId: String(other), feeTransactionId: String(posting) }))
        .success
    ).toBe(true);
    const result = await create({ feeTransactionId: "" });
    expect(result.errors.transferTransactionId).toEqual([
      "That transaction is already linked to another balance transfer.",
    ]);
  });

  it("rejects an end date on or before the posting date", async () => {
    const result = await create({ promoEndDate: "2020-03-01" });
    expect(result.errors.promoEndDate).toEqual([
      "The promo end date must be after the transfer's posting date.",
    ]);
  });

  it("rejects an APR outside 0–100", async () => {
    const result = await create({ promoApr: "100.5" });
    expect(result.errors.promoApr).toEqual([
      "APR must be between 0 and 100, with at most 3 decimal places",
    ]);
  });

  it("rejects a fee on a different account", async () => {
    const other = await createAccount("BT Action Test - Other Card", TYPE_CREDIT_CARD);
    const otherFee = await insertTx(other, "-90.00", "2020-03-04");
    const result = await create({ feeTransactionId: String(otherFee) });
    expect(result.errors.feeTransactionId).toEqual([
      "The fee must be a transaction on the same card as the transfer.",
    ]);
  });

  it("rejects a fee that is the posting itself", async () => {
    const result = await create({ feeTransactionId: String(posting) });
    expect(result.errors.feeTransactionId).toEqual([
      "The fee can't be the transfer's own posting",
    ]);
  });

  it("rejects a fee already linked to another transfer", async () => {
    const other = await insertTx(card, "-1000.00", "2020-02-01", INTERNAL_TRANSFER);
    expect((await create({ transferTransactionId: String(other) })).success).toBe(true);
    const result = await create();
    expect(result.errors.feeTransactionId).toEqual([
      "That fee transaction is already linked to another balance transfer.",
    ]);
  });
});

// ─── updateBalanceTransfer ───────────────────────────────────────────────────

describe("updateBalanceTransfer", () => {
  async function created(): Promise<number> {
    expect((await create()).success).toBe(true);
    const [row] = await transfersOn(posting);
    return row.balanceTransferId;
  }

  it("edits the terms, keeping its own links valid", async () => {
    const id = await created();
    const result = await updateBalanceTransfer(
      emptyState,
      form({ balanceTransferId: String(id), promoEndDate: "2021-12-01", promoApr: "1.5" })
    );
    expect(result).toEqual({ success: true, errors: {}, message: "Balance transfer updated" });

    const [row] = await transfersOn(posting);
    expect(row).toMatchObject({ promoEndDate: "2021-12-01", promoApr: "1.500", feeTransactionId: fee });
  });

  it("can drop the fee", async () => {
    const id = await created();
    const result = await updateBalanceTransfer(
      emptyState,
      form({ balanceTransferId: String(id), feeTransactionId: "" })
    );
    expect(result.success).toBe(true);
    const [row] = await transfersOn(posting);
    expect(row.feeTransactionId).toBeNull();
  });

  it("refuses a transfer that is not on this account", async () => {
    const id = await created();
    const other = await createAccount("BT Action Test - Other Card", TYPE_CREDIT_CARD);
    const result = await updateBalanceTransfer(
      emptyState,
      form({ balanceTransferId: String(id), accountId: String(other) })
    );
    expect(result).toEqual({ success: false, errors: {}, message: "Balance transfer not found" });
  });

  it("refuses an unknown transfer", async () => {
    const result = await updateBalanceTransfer(
      emptyState,
      form({ balanceTransferId: "2147483647" })
    );
    expect(result.message).toBe("Balance transfer not found");
  });
});

// ─── deleteBalanceTransfer ───────────────────────────────────────────────────

describe("deleteBalanceTransfer", () => {
  it("removes the terms and leaves both transactions alone", async () => {
    expect((await create()).success).toBe(true);
    const [row] = await transfersOn(posting);

    const result = await deleteBalanceTransfer(
      emptyState,
      makeFormData({ balanceTransferId: String(row.balanceTransferId) })
    );
    expect(result).toEqual({ success: true, errors: {}, message: "Balance transfer removed" });
    expect(await transfersOn(posting)).toEqual([]);

    const remaining = await db
      .select({ id: transactions.transactionId })
      .from(transactions)
      .where(inArray(transactions.transactionId, [posting, fee]));
    expect(remaining).toHaveLength(2);
  });

  it("refuses an unknown transfer", async () => {
    const result = await deleteBalanceTransfer(
      emptyState,
      makeFormData({ balanceTransferId: "2147483647" })
    );
    expect(result).toEqual({ success: false, errors: {}, message: "Balance transfer not found" });
  });
});

// ─── deleteTransaction on linked rows ────────────────────────────────────────

describe("deleteTransaction on a balance transfer's transactions", () => {
  it("refuses to delete a linked posting, and deletes nothing", async () => {
    expect((await create()).success).toBe(true);

    const result = await deleteTransaction(
      emptyState,
      makeFormData({ transactionId: String(posting) })
    );
    expect(result).toEqual({
      success: false,
      errors: {},
      message: "This transaction is the posting of a balance transfer. Remove the transfer first.",
    });

    const [still] = await db
      .select({ id: transactions.transactionId })
      .from(transactions)
      .where(eq(transactions.transactionId, posting));
    expect(still).toBeDefined();
    expect(await transfersOn(posting)).toHaveLength(1);
  });

  it("deletes a linked fee and leaves the transfer with no fee", async () => {
    expect((await create()).success).toBe(true);

    const result = await deleteTransaction(
      emptyState,
      makeFormData({ transactionId: String(fee) })
    );
    expect(result.success).toBe(true);

    const [row] = await transfersOn(posting);
    expect(row.feeTransactionId).toBeNull();
  });

  it("deletes the posting once the transfer is removed", async () => {
    expect((await create()).success).toBe(true);
    const [row] = await transfersOn(posting);
    await deleteBalanceTransfer(
      emptyState,
      makeFormData({ balanceTransferId: String(row.balanceTransferId) })
    );

    const result = await deleteTransaction(
      emptyState,
      makeFormData({ transactionId: String(posting) })
    );
    expect(result.success).toBe(true);
  });
});
