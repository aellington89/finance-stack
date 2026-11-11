import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  transactions,
  transactionCategories,
  accountBalanceHistory,
  auditLog,
  balanceTransfers,
} from "@/drizzle/schema";
import {
  submitTransaction,
  updateTransaction,
  duplicateTransaction,
  deleteTransaction,
} from "@/lib/actions/transaction";
import { createAccount } from "@/lib/actions/account";
import { createTransactionCategory } from "@/lib/actions/categories";
import {
  createBalanceTransfer,
  updateBalanceTransfer,
  deleteBalanceTransfer,
} from "@/lib/actions/balance-transfer";
import { auditedTransaction } from "@/lib/db/audited";

// The session vitest-setup.ts installs by default.
const SESSION_USER_ID = "00000000-0000-0000-0000-000000000000";
const SESSION_USER_NAME = "integration-test-user";

const ACCOUNT_NAME = "Audit Test Account";
const ACTION_ACCOUNT_NAME = "Audit Test Account (via action)";
const CATEGORY_NAME = "Audit Test Category";
const emptyState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) fd.append(key, val);
  return fd;
}

let accountId: number;
let createdAccountIds: number[];
// Highest audit_id that existed before the current test. Everything above it is
// this test's doing — which is both how the assertions ignore history from
// earlier runs and how the cleanup avoids discarding it. Safe because
// vitest.config.ts sets fileParallelism: false and tests within a file are
// sequential, so nothing else is writing audit_log concurrently.
let auditWatermark: number;

/** Audit rows this test caused for one row of one table, oldest first. */
function auditRowsFor(tableName: string, rowPk: number | string) {
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tableName, tableName),
        eq(auditLog.rowPk, String(rowPk)),
        gt(auditLog.auditId, auditWatermark)
      )
    )
    .orderBy(auditLog.auditId);
}

/** How many audit rows this test has caused for a table so far. */
async function auditCountFor(tableName: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tableName, tableName),
        gt(auditLog.auditId, auditWatermark)
      )
    );
  return count;
}

beforeEach(async () => {
  // int8 arrives from pg as a string.
  const [{ max }] = await db
    .select({ max: sql<string>`coalesce(max(audit_id), 0)` })
    .from(auditLog);
  auditWatermark = Number(max);

  createdAccountIds = [];
  const [inserted] = await db
    .insert(accounts)
    .values({ accountName: ACCOUNT_NAME, accountTypeId: 1 })
    .returning({ accountId: accounts.accountId });
  accountId = inserted.accountId;
  createdAccountIds.push(accountId);
});

afterEach(async () => {
  // Balance transfers first: a linked posting's foreign key is RESTRICT.
  await db.execute(sql`
    DELETE FROM balance_transfers bt
    USING transactions p
    WHERE p.transaction_id = bt.transfer_transaction_id
      AND p.account_id IN (${sql.join(createdAccountIds.map((id) => sql`${id}`), sql`, `)})
  `);
  await db
    .delete(transactions)
    .where(inArray(transactions.accountId, createdAccountIds));
  await db
    .delete(accountBalanceHistory)
    .where(inArray(accountBalanceHistory.accountId, createdAccountIds));
  await db
    .delete(accounts)
    .where(inArray(accounts.accountId, createdAccountIds));
  await db
    .delete(transactionCategories)
    .where(eq(transactionCategories.transactionCategory, CATEGORY_NAME));

  // Last: the deletes above are themselves audited.
  await db.delete(auditLog).where(gt(auditLog.auditId, auditWatermark));
});

async function insertTransaction(amount: string, date = "2024-05-01") {
  const result = await submitTransaction(
    emptyState,
    makeFormData({
      transactionDescription: "Audit subject",
      transactionDate: date,
      amount,
      accountId: String(accountId),
      transactionTypeId: "1",
      transactionCategoryId: "1",
    })
  );
  expect(result.success).toBe(true);

  const [row] = await db
    .select({ id: transactions.transactionId })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));
  return row.id;
}

describe("audit logging — transaction lifecycle", () => {
  it("records actor and before/after for create, update and delete", async () => {
    const txnId = await insertTransaction("-82.50");

    await updateTransaction(
      emptyState,
      makeFormData({
        transactionId: String(txnId),
        transactionDescription: "Audit subject",
        transactionDate: "2024-05-01",
        amount: "-99.99",
        accountId: String(accountId),
        transactionTypeId: "1",
        transactionCategoryId: "1",
      })
    );

    await deleteTransaction(
      emptyState,
      makeFormData({ transactionId: String(txnId) })
    );

    const rows = await auditRowsFor("transactions", txnId);
    expect(rows.map((r) => r.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);

    // Actor, on every one of them.
    for (const row of rows) {
      expect(row.actorSource).toBe("app");
      expect(row.actorUserId).toBe(SESSION_USER_ID);
      expect(row.actorLabel).toBe(SESSION_USER_NAME);
    }

    const [insertRow, updateRow, deleteRow] = rows;

    expect(insertRow.beforeData).toBeNull();
    expect(insertRow.afterData).toMatchObject({
      transaction_description: "Audit subject",
    });
    expect(deleteRow.beforeData).toMatchObject({
      transaction_description: "Audit subject",
    });
    expect(deleteRow.afterData).toBeNull();

    // The acceptance criterion: the old and new amount on an edit. Read through
    // `->>` rather than off the parsed jsonb — to_jsonb() renders a numeric
    // column as a JSON *number*, so JSON.parse would hand back -82.5 and lose
    // the scale. This is also the query shape docs/audit-log.md documents.
    const amounts = (
      await db.execute(sql`
        SELECT before_data ->> 'amount' AS was,
               after_data  ->> 'amount' AS now
        FROM audit_log
        WHERE audit_id = ${updateRow.auditId}
      `)
    ).rows as { was: string; now: string }[];

    expect(amounts[0].was).toBe("-82.50");
    expect(amounts[0].now).toBe("-99.99");
    expect(updateRow.changedColumns).toEqual(["amount"]);
  });

  // Issue #241's acceptance criterion: "audit trail shows the duplicate
  // relationship". Nothing in the trigger changed for it — to_jsonb(NEW)
  // picks up duplicated_from_transaction_id like any other column.
  it("records a duplicate's source in its INSERT row, and nothing on the source", async () => {
    const sourceId = await insertTransaction("-82.50");

    const result = await duplicateTransaction(
      emptyState,
      makeFormData({
        sourceTransactionId: String(sourceId),
        transactionDescription: "Audit subject (copy)",
        transactionDate: "2024-06-01",
        amount: "-82.50",
        accountId: String(accountId),
        transactionTypeId: "1",
        transactionCategoryId: "1",
      })
    );
    expect(result.success).toBe(true);

    const [copy] = await db
      .select({ id: transactions.transactionId })
      .from(transactions)
      .where(eq(transactions.duplicatedFromTransactionId, sourceId));

    const copyRows = await auditRowsFor("transactions", copy.id);
    expect(copyRows.map((r) => r.action)).toEqual(["INSERT"]);
    expect(copyRows[0].actorSource).toBe("app");
    expect(copyRows[0].actorUserId).toBe(SESSION_USER_ID);
    expect(copyRows[0].actorLabel).toBe(SESSION_USER_NAME);

    // Through `->>`, the shape docs/audit-log.md documents for finding copies.
    const linked = (
      await db.execute(sql`
        SELECT row_pk
        FROM audit_log
        WHERE table_name = 'transactions'
          AND action = 'INSERT'
          AND after_data ->> 'duplicated_from_transaction_id' = ${String(sourceId)}
          AND audit_id > ${auditWatermark}
      `)
    ).rows as { row_pk: string }[];
    expect(linked).toEqual([{ row_pk: String(copy.id) }]);

    // The source was read, never written: its own creation is all there is.
    const sourceRows = await auditRowsFor("transactions", sourceId);
    expect(sourceRows.map((r) => r.action)).toEqual(["INSERT"]);
  });

  it("does not audit derived balance history", async () => {
    await insertTransaction("-25.00");

    // rebuildAccountBalance() rewrites the whole series on every write; a
    // trigger here would bury the signal. Pinned so adding one is deliberate.
    expect(await auditCountFor("account_balance_history")).toBe(0);
  });

  it("writes no audit row when the transaction rolls back", async () => {
    const before = await auditCountFor("transactions");

    await expect(
      auditedTransaction(async (tx) => {
        await tx.insert(transactions).values({
          transactionDescription: "Rolled back",
          transactionDate: "2024-05-02",
          accountId,
          amount: "-1.00",
          relatedAccountId: null,
          transactionTypeId: 1,
          transactionCategoryId: 1,
        });
        throw new Error("forced rollback");
      })
    ).rejects.toThrow("forced rollback");

    expect(await auditCountFor("transactions")).toBe(before);
  });
});

describe("audit logging — actor attribution", () => {
  it("attributes a write made outside auditedTransaction to the database role", async () => {
    // This is the importer's path: no GUC set, so the trigger falls back to
    // current_user rather than recording an anonymous change.
    const [inserted] = await db
      .insert(transactions)
      .values({
        transactionDescription: "Direct write",
        transactionDate: "2024-05-03",
        accountId,
        amount: "-5.00",
        relatedAccountId: null,
        transactionTypeId: 1,
        transactionCategoryId: 1,
      })
      .returning({ id: transactions.transactionId });

    const [row] = await auditRowsFor("transactions", inserted.id);
    expect(row.actorSource).toBe("database");
    expect(row.actorUserId).toBeNull();

    const [{ user }] = (
      await db.execute(sql`SELECT current_user AS user`)
    ).rows as { user: string }[];
    expect(row.actorLabel).toBe(user);
  });

  it("does not leak an actor onto the next write on the same pooled connection", async () => {
    // set_config(..., true) is transaction-local. Were it session-scoped, the
    // setting would outlive the audited write on that pooled connection and the
    // unattributed follow-up below would inherit the signed-in user.
    const attributedId = await insertTransaction("-11.00");
    const [attributed] = await auditRowsFor("transactions", attributedId);
    expect(attributed.actorUserId).toBe(SESSION_USER_ID);

    const [inserted] = await db
      .insert(transactions)
      .values({
        transactionDescription: "Unattributed follow-up",
        transactionDate: "2024-05-04",
        accountId,
        amount: "-12.00",
        relatedAccountId: null,
        transactionTypeId: 1,
        transactionCategoryId: 1,
      })
      .returning({ id: transactions.transactionId });

    const [row] = await auditRowsFor("transactions", inserted.id);
    expect(row.actorSource).toBe("database");
    expect(row.actorUserId).toBeNull();
    expect(row.actorLabel).not.toBe(SESSION_USER_NAME);
  });
});

describe("audit logging — other audited tables", () => {
  it("audits account creation through the server action", async () => {
    const result = await createAccount(
      emptyState,
      makeFormData({
        accountName: ACTION_ACCOUNT_NAME,
        accountTypeId: "1",
      })
    );
    expect(result.success).toBe(true);

    const [created] = await db
      .select({ id: accounts.accountId })
      .from(accounts)
      .where(eq(accounts.accountName, ACTION_ACCOUNT_NAME));
    createdAccountIds.push(created.id);

    const [row] = await auditRowsFor("accounts", created.id);
    expect(row.action).toBe("INSERT");
    expect(row.actorSource).toBe("app");
    expect(row.afterData).toMatchObject({ account_name: ACTION_ACCOUNT_NAME });
  });

  it("audits lookup-table edits, which retroactively change what transactions mean", async () => {
    const result = await createTransactionCategory(
      emptyState,
      makeFormData({ name: CATEGORY_NAME })
    );
    expect(result.success).toBe(true);

    const [created] = await db
      .select({ id: transactionCategories.transactionCategoryId })
      .from(transactionCategories)
      .where(eq(transactionCategories.transactionCategory, CATEGORY_NAME));

    const [row] = await auditRowsFor("transaction_categories", created.id);
    expect(row.action).toBe("INSERT");
    expect(row.actorSource).toBe("app");
    expect(row.actorLabel).toBe(SESSION_USER_NAME);
  });
});

describe("audit logging — balance transfers (Issue #417)", () => {
  it("audits create, edit and delete through the actions, and a fee unlink", async () => {
    const [card] = await db
      .insert(accounts)
      .values({ accountName: "Audit Test Card", accountTypeId: 15 })
      .returning({ accountId: accounts.accountId });
    createdAccountIds.push(card.accountId);

    const [posting, fee] = await db
      .insert(transactions)
      .values([
        {
          transactionDescription: "Audit transfer posting",
          transactionDate: "2024-05-01",
          accountId: card.accountId,
          amount: "-2000.00",
          transactionTypeId: 1,
          transactionCategoryId: 1,
        },
        {
          transactionDescription: "Audit transfer fee",
          transactionDate: "2024-05-04",
          accountId: card.accountId,
          amount: "-60.00",
          transactionTypeId: 2,
          transactionCategoryId: 1,
        },
      ])
      .returning({ id: transactions.transactionId });

    const fields = {
      accountId: String(card.accountId),
      transferTransactionId: String(posting.id),
      feeTransactionId: String(fee.id),
      promoEndDate: "2025-11-01",
      promoApr: "0",
    };

    expect((await createBalanceTransfer(emptyState, makeFormData(fields))).success).toBe(true);
    const [bt] = await db
      .select({ id: balanceTransfers.balanceTransferId })
      .from(balanceTransfers)
      .where(eq(balanceTransfers.transferTransactionId, posting.id));

    expect(
      (
        await updateBalanceTransfer(
          emptyState,
          makeFormData({ ...fields, balanceTransferId: String(bt.id), promoApr: "2.5" })
        )
      ).success
    ).toBe(true);

    // Deleting the fee unlinks it through ON DELETE SET NULL, which is a row
    // UPDATE: the trigger records it, attributed to whoever deleted the fee.
    expect(
      (await deleteTransaction(emptyState, makeFormData({ transactionId: String(fee.id) })))
        .success
    ).toBe(true);

    expect(
      (
        await deleteBalanceTransfer(
          emptyState,
          makeFormData({ balanceTransferId: String(bt.id) })
        )
      ).success
    ).toBe(true);

    const rows = await auditRowsFor("balance_transfers", bt.id);
    expect(rows.map((r) => r.action)).toEqual(["INSERT", "UPDATE", "UPDATE", "DELETE"]);
    for (const row of rows) {
      expect(row.actorSource).toBe("app");
      expect(row.actorUserId).toBe(SESSION_USER_ID);
    }
    expect(rows[0].afterData).toMatchObject({
      transfer_transaction_id: posting.id,
      fee_transaction_id: fee.id,
    });
    expect(rows[1].changedColumns).toEqual(["promo_apr"]);
    expect(rows[2].changedColumns).toEqual(["fee_transaction_id"]);
    expect(rows[2].afterData).toMatchObject({ fee_transaction_id: null });
    expect(rows[3].beforeData).toMatchObject({ transfer_transaction_id: posting.id });
  });
});
