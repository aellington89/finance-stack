"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auditedTransaction, type Tx } from "@/lib/db/audited";
import { recurringTransactions } from "@/drizzle/schema";
import {
  checkRecurringSchedule,
  isScheduleChange,
  recurringTransactionFormSchema,
  type RecurringScheduleProblem,
  type RecurringTransactionFormData,
  type StoredSchedule,
  type SubmittedSchedule,
} from "@/lib/validations/recurring-transaction";
import { parseEntityId } from "@/lib/validations/id";
import { type ActionState, buildFieldErrors } from "@/lib/actions/utils";
import { actionFailure } from "@/lib/actions/failure";
import { requireActionUser } from "@/lib/auth/guard";
import { currentDate, materializeTemplate } from "@/lib/recurring/materialize";
import { nextOccurrenceOnOrAfter, type Cadence } from "@/lib/recurring/schedule";

// Recurring transactions (Issue #135). A template is the six transaction
// fields plus a schedule. The hourly scheduler creates its due occurrences
// (lib/recurring/), and so does a save. Create and update both run
// materializeTemplate() inside their own transaction, so a template that is
// already due fills in at once, attributed to the person saving, rather than
// waiting up to an hour and tempting them to enter it by hand.
//
// The rules that need the database (today's date, the account's open/closed
// window, the row being edited) are read inside the transaction and checked by
// checkRecurringSchedule() in lib/validations/recurring-transaction.ts.
//
// Module-private helpers only: a "use server" module may export nothing but
// async actions, and validation-contract.test.ts holds each export to a
// registry row.

function revalidateRecurringPaths(createdTransactions: boolean) {
  revalidatePath("/dashboard/transactions/recurring");
  if (createdTransactions) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/transactions");
    revalidatePath("/accounts");
  }
}

function readRecurringFields(formData: FormData) {
  return {
    transactionDescription: formData.get("transactionDescription") as string,
    amount: formData.get("amount") as string,
    accountId: formData.get("accountId") as string,
    relatedAccountId: (formData.get("relatedAccountId") as string) || undefined,
    transactionTypeId: formData.get("transactionTypeId") as string,
    transactionCategoryId: formData.get("transactionCategoryId") as string,
    cadence: formData.get("cadence") as string,
    intervalCount: formData.get("intervalCount") as string,
    nextRunDate: formData.get("nextRunDate") as string,
    endDate: (formData.get("endDate") as string) || undefined,
    isActive: (formData.get("isActive") as string) || undefined,
  };
}

function problemsToState(problems: RecurringScheduleProblem[]): ActionState {
  return {
    success: false,
    errors: buildFieldErrors(problems.map((p) => ({ path: [p.field], message: p.message }))),
    message: "Validation failed",
  };
}

function validationFailure(issues: Parameters<typeof buildFieldErrors>[0]): ActionState {
  return { success: false, errors: buildFieldErrors(issues), message: "Validation failed" };
}

/**
 * The account's open/closed window, locked FOR SHARE for the rest of the save.
 * A close in flight either commits first, and is refused here, or waits until
 * the save is in. Without the lock it could land between this read and
 * materializeTemplate(), which would pause the template while the save still
 * reported it active.
 */
async function readAccountWindow(tx: Tx, accountId: number) {
  const result = await tx.execute<{ opened_date: string | null; closed_date: string | null }>(sql`
    SELECT opened_date::text AS opened_date, closed_date::text AS closed_date
    FROM accounts WHERE account_id = ${accountId}
    FOR SHARE
  `);
  const row = result.rows[0];
  return row ? { openedDate: row.opened_date, closedDate: row.closed_date } : null;
}

function submittedSchedule(data: RecurringTransactionFormData, isActive: boolean): SubmittedSchedule {
  return {
    cadence: data.cadence,
    every: Number(data.intervalCount),
    nextRunDate: data.nextRunDate,
    endDate: data.endDate ?? null,
    isActive,
    accountId: Number(data.accountId),
  };
}

/** The six transaction fields, as the table stores them. */
function templateFields(data: RecurringTransactionFormData) {
  return {
    transactionDescription: data.transactionDescription,
    amount: data.amount,
    accountId: Number(data.accountId),
    relatedAccountId: data.relatedAccountId ? Number(data.relatedAccountId) : null,
    transactionTypeId: Number(data.transactionTypeId),
    transactionCategoryId: Number(data.transactionCategoryId),
  };
}

function savedMessage(verb: "saved" | "updated", created: number): string {
  const base = `Recurring transaction ${verb}`;
  if (created === 0) return base;
  return `${base}; ${created} ${created === 1 ? "transaction" : "transactions"} added`;
}

export async function createRecurringTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const result = recurringTransactionFormSchema.safeParse(readRecurringFields(formData));
  if (!result.success) return validationFailure(result.error.issues);

  const data = result.data;
  let refused: ActionState | null = null;
  let created = 0;

  try {
    await auditedTransaction(async (tx) => {
      const today = await currentDate(tx);
      const submitted = submittedSchedule(data, data.isActive !== "false");
      const problems = checkRecurringSchedule({
        submitted,
        stored: null,
        today,
        account: await readAccountWindow(tx, submitted.accountId),
      });
      if (problems.length > 0) {
        refused = problemsToState(problems);
        return;
      }

      const [row] = await tx
        .insert(recurringTransactions)
        .values({
          ...templateFields(data),
          cadence: submitted.cadence,
          intervalCount: submitted.every,
          anchorDate: submitted.nextRunDate,
          nextRunDate: submitted.nextRunDate,
          endDate: submitted.endDate,
          isActive: submitted.isActive,
        })
        .returning({ id: recurringTransactions.recurringTransactionId });

      created = (await materializeTemplate(tx, row.id, { today })).created;
    });
  } catch (error) {
    return actionFailure(
      "createRecurringTransaction",
      error,
      "Failed to save recurring transaction. Please try again."
    );
  }

  if (refused) return refused;

  revalidateRecurringPaths(created > 0);
  return { success: true, errors: {}, message: savedMessage("saved", created) };
}

export async function updateRecurringTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = parseEntityId(formData.get("recurringTransactionId"));
  if (id === null) {
    return { success: false, errors: {}, message: "Invalid recurring transaction ID" };
  }

  const result = recurringTransactionFormSchema.safeParse(readRecurringFields(formData));
  if (!result.success) return validationFailure(result.error.issues);

  const data = result.data;
  let refused: ActionState | null = null;
  let created = 0;

  try {
    await auditedTransaction(async (tx) => {
      // Locked for the rest of the save, so the scheduler can't advance it
      // between this read and the write below.
      const existing = await tx.execute<{
        cadence: Cadence;
        interval_count: number;
        anchor_date: string;
        next_run_date: string;
        end_date: string | null;
        is_active: boolean;
        account_id: number;
      }>(sql`
        SELECT cadence, interval_count, anchor_date::text AS anchor_date,
               next_run_date::text AS next_run_date, end_date::text AS end_date,
               is_active, account_id
        FROM recurring_transactions
        WHERE recurring_transaction_id = ${id}
        FOR UPDATE
      `);
      const row = existing.rows[0];
      if (!row) {
        refused = { success: false, errors: {}, message: "Recurring transaction not found" };
        return;
      }
      const stored: StoredSchedule = {
        cadence: row.cadence,
        every: row.interval_count,
        anchorDate: row.anchor_date,
        nextRunDate: row.next_run_date,
        endDate: row.end_date,
        isActive: row.is_active,
        accountId: row.account_id,
      };

      const today = await currentDate(tx);
      // An update without the flag keeps whatever is stored.
      const isActive = data.isActive === undefined ? stored.isActive : data.isActive === "true";
      const submitted = submittedSchedule(data, isActive);
      const problems = checkRecurringSchedule({
        submitted,
        stored,
        today,
        account: await readAccountWindow(tx, submitted.accountId),
      });
      if (problems.length > 0) {
        refused = problemsToState(problems);
        return;
      }

      // A new cadence, interval or next date starts a new schedule from the
      // next date. Otherwise the anchor stays, which is what brings a monthly
      // 31st back to the 31st after a short month.
      let anchorDate = stored.anchorDate;
      let nextRunDate = stored.nextRunDate;
      if (isScheduleChange(submitted, stored)) {
        anchorDate = submitted.nextRunDate;
        nextRunDate = submitted.nextRunDate;
      } else if (!stored.isActive && submitted.isActive && stored.nextRunDate < today) {
        // Resuming skips the dates missed while paused rather than backfilling
        // them. A new next date in the same save takes the branch above and is
        // honored as a deliberate backfill.
        nextRunDate = nextOccurrenceOnOrAfter(
          { cadence: stored.cadence, every: stored.every, anchorDate, endDate: submitted.endDate },
          today
        );
      }

      await tx
        .update(recurringTransactions)
        .set({
          ...templateFields(data),
          cadence: submitted.cadence,
          intervalCount: submitted.every,
          anchorDate,
          nextRunDate,
          endDate: submitted.endDate,
          isActive: submitted.isActive,
        })
        .where(eq(recurringTransactions.recurringTransactionId, id));

      created = (await materializeTemplate(tx, id, { today })).created;
    });
  } catch (error) {
    return actionFailure(
      "updateRecurringTransaction",
      error,
      "Failed to update recurring transaction. Please try again."
    );
  }

  if (refused) return refused;

  revalidateRecurringPaths(created > 0);
  return { success: true, errors: {}, message: savedMessage("updated", created) };
}

/**
 * Removes the template only. The transactions it created are ordinary
 * transactions and stay, still carrying its id (no FK, by design).
 */
export async function deleteRecurringTransaction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = await requireActionUser();
  if (denied) return denied;

  const id = parseEntityId(formData.get("recurringTransactionId"));
  if (id === null) {
    return { success: false, errors: {}, message: "Invalid recurring transaction ID" };
  }

  let deleted = false;

  try {
    await auditedTransaction(async (tx) => {
      const rows = await tx
        .delete(recurringTransactions)
        .where(eq(recurringTransactions.recurringTransactionId, id))
        .returning({ id: recurringTransactions.recurringTransactionId });
      deleted = rows.length > 0;
    });
  } catch (error) {
    return actionFailure(
      "deleteRecurringTransaction",
      error,
      "Failed to delete recurring transaction. Please try again."
    );
  }

  if (!deleted) {
    return { success: false, errors: {}, message: "Recurring transaction not found" };
  }

  revalidateRecurringPaths(false);
  return {
    success: true,
    errors: {},
    message: "Recurring transaction deleted. Transactions it already added are kept.",
  };
}
