"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auditedTransaction, type Tx } from "@/lib/db/audited";
import { balanceTransfers } from "@/drizzle/schema";
import {
  balanceTransferFormSchema,
  checkBalanceTransferLinks,
  type BalanceTransferFormData,
  type BalanceTransferLinkFacts,
  type BalanceTransferLinkProblem,
  type LinkedTransactionFacts,
} from "@/lib/validations/balance-transfer";
import { parseEntityId } from "@/lib/validations/id";
import { type ActionState, buildFieldErrors } from "@/lib/actions/utils";
import { actionFailure } from "@/lib/actions/failure";
import { requireActionUser } from "@/lib/auth/guard";

// Balance transfers (Issue #417). A transfer is an annotation on a posting that
// is already in the ledger, so these actions never write a transaction. They
// link two existing ones and record the offer's end date and APR.
//
// The link rules that need the database (which card, already linked, end date
// after the posting) are read inside the same transaction as the write and
// checked by checkBalanceTransferLinks() in lib/validations/balance-transfer.ts.
// The two UNIQUE constraints remain the backstop for a race between two tabs.
// The loser lands in actionFailure()'s generic message.
//
// Module-private helpers only: a "use server" module may export nothing but
// async actions, and validation-contract.test.ts holds each export to a
// registry row.

function revalidateBalanceTransferPaths(accountId: number) {
  revalidatePath(`/accounts/${accountId}/edit`);
  revalidatePath("/dashboard/liabilities");
  revalidatePath("/dashboard");
}

function readBalanceTransferFields(formData: FormData) {
  return {
    accountId: formData.get("accountId") as string,
    transferTransactionId: formData.get("transferTransactionId") as string,
    feeTransactionId:
      (formData.get("feeTransactionId") as string) || undefined,
    promoEndDate: formData.get("promoEndDate") as string,
    promoApr: formData.get("promoApr") as string,
  };
}

function problemsToState(problems: BalanceTransferLinkProblem[]): ActionState {
  const accountProblem = problems.find((p) => p.field === "accountId");
  return {
    success: false,
    errors: buildFieldErrors(
      problems.map((p) => ({ path: [p.field], message: p.message }))
    ),
    // The dialog has no account field to show an account problem under, so it
    // is the message (a toast) rather than "Validation failed".
    message: accountProblem?.message ?? "Validation failed",
  };
}

async function readTransactionFacts(
  tx: Tx,
  transactionId: number,
  editingId: number | null
): Promise<LinkedTransactionFacts | null> {
  const result = await tx.execute(sql`
    SELECT
      t.account_id,
      t.amount,
      t.transaction_date,
      (SELECT bt.balance_transfer_id FROM balance_transfers bt
       WHERE (bt.transfer_transaction_id = t.transaction_id
              OR bt.fee_transaction_id = t.transaction_id)
         AND bt.balance_transfer_id IS DISTINCT FROM ${editingId}::integer
       LIMIT 1) AS linked_to
    FROM transactions t
    WHERE t.transaction_id = ${transactionId}
  `);
  const row = result.rows[0] as
    | {
        account_id: number;
        amount: string;
        transaction_date: string;
        linked_to: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    accountId: row.account_id,
    amount: parseFloat(row.amount),
    transactionDate: row.transaction_date,
    linkedToOtherTransfer: row.linked_to,
  };
}

async function readLinkFacts(
  tx: Tx,
  data: BalanceTransferFormData,
  editingId: number | null
): Promise<BalanceTransferLinkFacts> {
  const accountId = Number(data.accountId);
  const account = await tx.execute(sql`
    SELECT at.account_type_category_id
    FROM accounts a
    JOIN account_types at ON at.account_type_id = a.account_type_id
    WHERE a.account_id = ${accountId}
  `);
  const accountRow = account.rows[0] as
    | { account_type_category_id: number }
    | undefined;

  return {
    accountId,
    accountCategoryId: accountRow?.account_type_category_id ?? null,
    posting: await readTransactionFacts(
      tx,
      Number(data.transferTransactionId),
      editingId
    ),
    feeRequested: Boolean(data.feeTransactionId),
    fee: data.feeTransactionId
      ? await readTransactionFacts(tx, Number(data.feeTransactionId), editingId)
      : null,
    promoEndDate: data.promoEndDate,
  };
}

function rowValues(data: BalanceTransferFormData) {
  return {
    transferTransactionId: Number(data.transferTransactionId),
    feeTransactionId: data.feeTransactionId ? Number(data.feeTransactionId) : null,
    promoEndDate: data.promoEndDate,
    promoApr: data.promoApr,
  };
}

export async function createBalanceTransfer(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = balanceTransferFormSchema.safeParse(
    readBalanceTransferFields(formData)
  );
  if (!result.success) {
    return {
      success: false,
      errors: buildFieldErrors(result.error.issues),
      message: "Validation failed",
    };
  }

  const data = result.data;
  let refused: ActionState | null = null;

  try {
    await auditedTransaction(async (tx) => {
      const problems = checkBalanceTransferLinks(
        await readLinkFacts(tx, data, null)
      );
      if (problems.length > 0) {
        refused = problemsToState(problems);
        return;
      }
      await tx.insert(balanceTransfers).values(rowValues(data));
    });
  } catch (error) {
    return actionFailure(
      "createBalanceTransfer",
      error,
      "Failed to save balance transfer. Please try again."
    );
  }

  if (refused) return refused;

  revalidateBalanceTransferPaths(Number(data.accountId));
  return { success: true, errors: {}, message: "Balance transfer saved" };
}

export async function updateBalanceTransfer(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const balanceTransferId = parseEntityId(formData.get("balanceTransferId"));
  if (balanceTransferId === null) {
    return { success: false, errors: {}, message: "Invalid balance transfer ID" };
  }

  const result = balanceTransferFormSchema.safeParse(
    readBalanceTransferFields(formData)
  );
  if (!result.success) {
    return {
      success: false,
      errors: buildFieldErrors(result.error.issues),
      message: "Validation failed",
    };
  }

  const data = result.data;
  let refused: ActionState | null = null;

  try {
    await auditedTransaction(async (tx) => {
      // The transfer must exist and currently sit on this account: its posting
      // is what puts it there. An edit can repoint it to another posting on
      // the same card, not move it to another card from this page.
      const existing = await tx.execute(sql`
        SELECT p.account_id
        FROM balance_transfers bt
        JOIN transactions p ON p.transaction_id = bt.transfer_transaction_id
        WHERE bt.balance_transfer_id = ${balanceTransferId}
      `);
      const current = existing.rows[0] as { account_id: number } | undefined;
      if (!current || current.account_id !== Number(data.accountId)) {
        refused = {
          success: false,
          errors: {},
          message: "Balance transfer not found",
        };
        return;
      }

      const problems = checkBalanceTransferLinks(
        await readLinkFacts(tx, data, balanceTransferId)
      );
      if (problems.length > 0) {
        refused = problemsToState(problems);
        return;
      }

      await tx
        .update(balanceTransfers)
        .set(rowValues(data))
        .where(eq(balanceTransfers.balanceTransferId, balanceTransferId));
    });
  } catch (error) {
    return actionFailure(
      "updateBalanceTransfer",
      error,
      "Failed to update balance transfer. Please try again."
    );
  }

  if (refused) return refused;

  revalidateBalanceTransferPaths(Number(data.accountId));
  return { success: true, errors: {}, message: "Balance transfer updated" };
}

/**
 * Removes the transfer's terms. Its posting and fee are ordinary transactions
 * and stay exactly as they are, so no balance or total moves.
 */
export async function deleteBalanceTransfer(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const balanceTransferId = parseEntityId(formData.get("balanceTransferId"));
  if (balanceTransferId === null) {
    return { success: false, errors: {}, message: "Invalid balance transfer ID" };
  }

  let accountId: number | null = null;

  try {
    await auditedTransaction(async (tx) => {
      const existing = await tx.execute(sql`
        SELECT p.account_id
        FROM balance_transfers bt
        JOIN transactions p ON p.transaction_id = bt.transfer_transaction_id
        WHERE bt.balance_transfer_id = ${balanceTransferId}
      `);
      const row = existing.rows[0] as { account_id: number } | undefined;
      if (!row) return;
      accountId = row.account_id;

      await tx
        .delete(balanceTransfers)
        .where(eq(balanceTransfers.balanceTransferId, balanceTransferId));
    });
  } catch (error) {
    return actionFailure(
      "deleteBalanceTransfer",
      error,
      "Failed to delete balance transfer. Please try again."
    );
  }

  if (accountId === null) {
    return { success: false, errors: {}, message: "Balance transfer not found" };
  }

  revalidateBalanceTransferPaths(accountId);
  return { success: true, errors: {}, message: "Balance transfer removed" };
}
