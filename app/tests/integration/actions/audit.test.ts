import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  transactions,
  transactionCategories,
  accountBalanceHistory,
  auditLog,
} from "@/drizzle/schema";
import {
  submitTransaction,
  updateTransaction,
  deleteTransaction,
} from "@/lib/actions/transaction";
import { createAccount } from "@/lib/actions/account";
import { createTransactionCategory } from "@/lib/actions/categories";
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
