"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auditedTransaction, type Tx } from "@/lib/db/audited";
import {
  transactions,
  accountBalanceHistory,
  balanceTransfers,
} from "@/drizzle/schema";
import {
  transactionFormSchema,
  type TransactionFormData,
} from "@/lib/validations/transaction";
import { parseEntityId } from "@/lib/validations/id";
import { rebuildAccountBalance } from "@/lib/queries/rebuild-balance";
import { type ActionState, buildFieldErrors } from "@/lib/actions/utils";
import { actionFailure } from "@/lib/actions/failure";
import { requireActionUser } from "@/lib/auth/guard";

function revalidateTransactionPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/accounts");
}

// The helpers below are module-private on purpose. A "use server" module may
// only export async actions, and validation-contract.test.ts holds every
// exported function to a registry row — an exported helper would fail both.

/** The seven form fields, raw, for transactionFormSchema to parse. */
function readTransactionFields(formData: FormData) {
  return {
    transactionDescription: formData.get("transactionDescription") as string,
    transactionDate: formData.get("transactionDate") as string,
    amount: formData.get("amount") as string,
    accountId: formData.get("accountId") as string,
    relatedAccountId:
      (formData.get("relatedAccountId") as string) || undefined,
    transactionTypeId: formData.get("transactionTypeId") as string,
    transactionCategoryId: formData.get("transactionCategoryId") as string,
  };
}

/**
 * Inserts one transaction and rebuilds the balance history it touches. Shared
 * by submitTransaction (no provenance) and duplicateTransaction (Issue #241),
 * which differ only in what they record as the row's source.
 */
async function insertTransactionAndRebuild(
  tx: Tx,
  data: TransactionFormData,
  duplicatedFromTransactionId: number | null
): Promise<void> {
  const accountId = Number(data.accountId);
  const relatedAccountId = data.relatedAccountId
    ? Number(data.relatedAccountId)
    : null;

  await tx.insert(transactions).values({
    transactionDescription: data.transactionDescription,
    transactionDate: data.transactionDate,
    accountId,
    amount: data.amount,
    relatedAccountId,
    transactionTypeId: Number(data.transactionTypeId),
    transactionCategoryId: Number(data.transactionCategoryId),
    duplicatedFromTransactionId,
  });

  await rebuildAccountBalance(tx, accountId);

  if (relatedAccountId) {
    await rebuildAccountBalance(tx, relatedAccountId);
  }
}

export async function submitTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = transactionFormSchema.safeParse(readTransactionFields(formData));

  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  const data = result.data;

  try {
    await auditedTransaction((tx) =>
      insertTransactionAndRebuild(tx, data, null)
    );
  } catch (error) {
    return actionFailure(
      "submitTransaction",
      error,
      "Failed to save transaction. Please try again."
    );
  }

  revalidateTransactionPaths();

  return {
    success: true,
    errors: {},
    message: "Transaction created successfully",
  };
}

export async function updateTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const transactionId = parseEntityId(formData.get("transactionId"));
  if (transactionId === null) {
    return { success: false, errors: {}, message: "Invalid transaction ID" };
  }

  const result = transactionFormSchema.safeParse(readTransactionFields(formData));
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  const data = result.data;
  const newAccountId = Number(data.accountId);
  const newRelatedAccountId = data.relatedAccountId
    ? Number(data.relatedAccountId)
    : null;

  let notFound = false;

  try {
    await auditedTransaction(async (tx) => {
      const [existing] = await tx
        .select({
          accountId: transactions.accountId,
          relatedAccountId: transactions.relatedAccountId,
        })
        .from(transactions)
        .where(eq(transactions.transactionId, transactionId))
        .limit(1);

      if (!existing) {
        notFound = true;
        return;
      }

      // duplicatedFromTransactionId is deliberately absent: editing a copy
      // does not change what it was copied from (Issue #241).
      await tx
        .update(transactions)
        .set({
          transactionDescription: data.transactionDescription,
          transactionDate: data.transactionDate,
          accountId: newAccountId,
          amount: data.amount,
          relatedAccountId: newRelatedAccountId,
          transactionTypeId: Number(data.transactionTypeId),
          transactionCategoryId: Number(data.transactionCategoryId),
        })
        .where(eq(transactions.transactionId, transactionId));

      const affectedAccountIds = new Set<number>();
      affectedAccountIds.add(existing.accountId);
      if (existing.relatedAccountId !== null) {
        affectedAccountIds.add(existing.relatedAccountId);
      }
      affectedAccountIds.add(newAccountId);
      if (newRelatedAccountId !== null) {
        affectedAccountIds.add(newRelatedAccountId);
      }

      for (const id of affectedAccountIds) {
        await rebuildAccountBalance(tx, id);
      }
    });
  } catch (error) {
    return actionFailure(
      "updateTransaction",
      error,
      "Failed to update transaction. Please try again."
    );
  }

  if (notFound) {
    return { success: false, errors: {}, message: "Transaction not found" };
  }

  revalidateTransactionPaths();

  return {
    success: true,
    errors: {},
    message: "Transaction updated successfully",
  };
}

/**
 * Saves an edited copy of an existing transaction as a new one (Issue #241).
 *
 * The form posts the seven fields — prefilled from the source in the UI, but
 * re-validated here like any other entry point — plus `sourceTransactionId`,
 * which is recorded as the new row's duplicated_from_transaction_id. The audit
 * trigger captures that column in the INSERT row, which is what makes the
 * relationship visible in the audit trail. The source itself is only read,
 * never written.
 *
 * The source must exist when the copy is made, so the link cannot be pointed
 * at an id that never existed. It may be deleted afterwards — the column has
 * no FK by design (see migration 0008) — so a delete racing this check lands
 * in the same state as "duplicated, then deleted" and needs no lock.
 */
export async function duplicateTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const sourceTransactionId = parseEntityId(formData.get("sourceTransactionId"));
  if (sourceTransactionId === null) {
    return { success: false, errors: {}, message: "Invalid transaction ID" };
  }

  const result = transactionFormSchema.safeParse(readTransactionFields(formData));
  if (!result.success) {
    return { success: false, errors: buildFieldErrors(result.error.issues), message: "Validation failed" };
  }

  const data = result.data;
  let notFound = false;

  try {
    await auditedTransaction(async (tx) => {
      const [source] = await tx
        .select({ transactionId: transactions.transactionId })
        .from(transactions)
        .where(eq(transactions.transactionId, sourceTransactionId))
        .limit(1);

      if (!source) {
        notFound = true;
        return;
      }

      await insertTransactionAndRebuild(tx, data, sourceTransactionId);
    });
  } catch (error) {
    return actionFailure(
      "duplicateTransaction",
      error,
      "Failed to duplicate transaction. Please try again."
    );
  }

  if (notFound) {
    return {
      success: false,
      errors: {},
      message: "The transaction being duplicated no longer exists",
    };
  }

  revalidateTransactionPaths();

  return {
    success: true,
    errors: {},
    message: "Transaction duplicated successfully",
  };
}

export async function deleteTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const transactionId = parseEntityId(formData.get("transactionId"));
  if (transactionId === null) {
    return { success: false, errors: {}, message: "Invalid transaction ID" };
  }

  let notFound = false;
  let isTransferPosting = false;

  try {
    await auditedTransaction(async (tx) => {
      const [existing] = await tx
        .select({
          accountId: transactions.accountId,
          relatedAccountId: transactions.relatedAccountId,
        })
        .from(transactions)
        .where(eq(transactions.transactionId, transactionId))
        .limit(1);

      if (!existing) {
        notFound = true;
        return;
      }

      // A balance transfer reads its card, amount and start date from its
      // posting (Issue #417), so deleting the posting would strand the
      // hand-entered terms. Refuse and say what to do, the way deleteAccount()
      // refuses an account with transactions. The RESTRICT foreign key is the
      // backstop for any other writer. A linked *fee* needs nothing here: its
      // key is ON DELETE SET NULL, so deleting it just unlinks it.
      const [linked] = await tx
        .select({ id: balanceTransfers.balanceTransferId })
        .from(balanceTransfers)
        .where(eq(balanceTransfers.transferTransactionId, transactionId))
        .limit(1);

      if (linked) {
        isTransferPosting = true;
        return;
      }

      await tx
        .delete(transactions)
        .where(eq(transactions.transactionId, transactionId));

      const affectedAccountIds = new Set<number>();
      affectedAccountIds.add(existing.accountId);
      if (existing.relatedAccountId !== null) {
        affectedAccountIds.add(existing.relatedAccountId);
      }

      for (const id of affectedAccountIds) {
        // rebuildAccountBalance starts its date series at MIN(transaction_date)
        // for the account; with no transactions left, the series is empty and
        // existing balance rows would be stale. Clear them first.
        const [{ count }] = await tx
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(transactions)
          .where(eq(transactions.accountId, id));

        if (count === 0) {
          await tx
            .delete(accountBalanceHistory)
            .where(eq(accountBalanceHistory.accountId, id));
        } else {
          await rebuildAccountBalance(tx, id);
        }
      }
    });
  } catch (error) {
    return actionFailure(
      "deleteTransaction",
      error,
      "Failed to delete transaction. Please try again."
    );
  }

  if (notFound) {
    return { success: false, errors: {}, message: "Transaction not found" };
  }

  if (isTransferPosting) {
    return {
      success: false,
      errors: {},
      message:
        "This transaction is the posting of a balance transfer. Remove the transfer first.",
    };
  }

  revalidateTransactionPaths();

  return {
    success: true,
    errors: {},
    message: "Transaction deleted successfully",
  };
}
