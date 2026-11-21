import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Tx } from "@/lib/db/audited";
import { recurringTransactions, transactions } from "@/drizzle/schema";
import { systemTransaction } from "@/lib/db/system-transaction";
import { rebuildAccountBalances } from "@/lib/queries/rebuild-balance";
import { dueOccurrences, type Cadence } from "@/lib/recurring/schedule";
import { log } from "@/lib/log";
import { reportError } from "@/lib/report";

/**
 * Turns due recurring-transaction templates into transactions rows (Issue
 * #135). Two entry points, one per caller the issue plans:
 *
 *   - **runDueTemplates()** is the hourly check's. Each template runs in its
 *     own systemTransaction, so the rows are audited as `recurring-schedule`,
 *     and one bad template is reported and skipped without holding up the
 *     rest.
 *   - **materializeTemplate()** runs inside a caller's transaction. A template
 *     save calls it inside its own auditedTransaction, so a template that is
 *     already due fills in at once, attributed to the person saving.
 *
 * "Exactly once" holds on two levels. The template row is locked FOR UPDATE
 * with the due predicate in the WHERE, so a second runner either waits and
 * then finds it no longer due (READ COMMITTED re-checks the predicate against
 * the committed row), or never sees it due at all. Underneath that, the
 * (recurring_transaction_id, recurring_occurrence_date) UNIQUE turns any
 * duplicate insert into a no-op, whoever attempts it.
 *
 * "Today" is never the app server's clock. runDueTemplates() reads Postgres's
 * CURRENT_DATE unless it's given one, the same "today" every balance uses, and
 * tests pass one in.
 */

/**
 * The most occurrences one template creates in one run. More than a year of a
 * daily schedule, which is as far back as a save may start one (a save refuses
 * a next date more than a year back), so any accepted backfill completes in a
 * single pass. A template still behind after a run stays due, and the next run
 * carries on from where this one stopped.
 */
export const MATERIALIZE_CAP = 400;

/** The audit label on rows the scheduler creates. */
export const RECURRING_SCHEDULE_ACTOR = "recurring-schedule";

/** How long one template's transaction waits on any lock before failing loudly. */
export const SCHEDULER_LOCK_TIMEOUT = "15s";

export interface MaterializeOutcome {
  /** Rows actually inserted. */
  created: number;
  /** True when the template paused itself because its account is closed. */
  pausedForClosedAccount: boolean;
  /** True when the template wasn't due (or another runner got there first). */
  skipped: boolean;
}

export interface RunSummary {
  today: string;
  /** Templates that were due when the run started. */
  due: number;
  created: number;
  paused: number;
  failed: number;
}

interface LockedTemplate {
  [key: string]: unknown;
  recurring_transaction_id: number;
  transaction_description: string;
  amount: string;
  account_id: number;
  related_account_id: number | null;
  transaction_type_id: number;
  transaction_category_id: number;
  cadence: Cadence;
  interval_count: number;
  anchor_date: string;
  next_run_date: string;
  end_date: string | null;
  account_closed_date: string | null;
}

/** Postgres's CURRENT_DATE, as `YYYY-MM-DD`. Stable for the rest of a transaction. */
export async function currentDate(executor: Pick<Tx, "execute"> = db): Promise<string> {
  const result = await executor.execute<{ today: string }>(sql`SELECT CURRENT_DATE::text AS today`);
  return result.rows[0].today;
}

/**
 * Creates every occurrence of one template that is due as of `today`, inside
 * the caller's transaction, then advances its next_run_date and rebuilds the
 * balances it touched.
 *
 * Every read goes through `tx`. At save time the template row is the caller's
 * own uncommitted insert or update, and `db` would not see it.
 *
 * A template whose account is closed creates only the occurrences before the
 * close date (rebuildAccountBalance ignores dates from it on) and then pauses
 * itself. Leaving it due would retry every hour, and backfill everything if the
 * account were ever reopened.
 */
export async function materializeTemplate(
  tx: Tx,
  recurringTransactionId: number,
  options: { today: string; cap?: number }
): Promise<MaterializeOutcome> {
  const cap = options.cap ?? MATERIALIZE_CAP;

  const locked = await tx.execute<LockedTemplate>(sql`
    SELECT r.recurring_transaction_id,
           r.transaction_description,
           r.amount::text AS amount,
           r.account_id,
           r.related_account_id,
           r.transaction_type_id,
           r.transaction_category_id,
           r.cadence,
           r.interval_count,
           r.anchor_date::text AS anchor_date,
           r.next_run_date::text AS next_run_date,
           r.end_date::text AS end_date,
           a.closed_date::text AS account_closed_date
    FROM recurring_transactions r
    JOIN accounts a ON a.account_id = r.account_id
    WHERE r.recurring_transaction_id = ${recurringTransactionId}
      AND r.is_active
      AND r.next_run_date <= ${options.today}::date
      AND (r.end_date IS NULL OR r.next_run_date <= r.end_date)
    FOR UPDATE OF r
  `);

  const template = locked.rows[0];
  if (!template) return { created: 0, pausedForClosedAccount: false, skipped: true };

  // Throws if next_run_date isn't an occurrence of the anchor. That is a row
  // edited by hand around the app; it fails loudly and stays due, rather than
  // being quietly re-anchored.
  const due = dueOccurrences(
    {
      cadence: template.cadence,
      every: template.interval_count,
      anchorDate: template.anchor_date,
      endDate: template.end_date,
    },
    template.next_run_date,
    options.today,
    cap
  );

  const closedDate = template.account_closed_date;
  const dates = closedDate === null ? due.dates : due.dates.filter((d) => d < closedDate);
  const pausedForClosedAccount = closedDate !== null && dates.length < due.dates.length;
  // When paused, next_run_date becomes the first occurrence not created: the
  // first one on or after the close date.
  const nextRunDate = pausedForClosedAccount ? due.dates[dates.length] : due.next;

  let created = 0;
  if (dates.length > 0) {
    const inserted = await tx
      .insert(transactions)
      .values(
        dates.map((date) => ({
          transactionDescription: template.transaction_description,
          transactionDate: date,
          accountId: template.account_id,
          amount: template.amount,
          relatedAccountId: template.related_account_id,
          transactionTypeId: template.transaction_type_id,
          transactionCategoryId: template.transaction_category_id,
          recurringTransactionId: template.recurring_transaction_id,
          recurringOccurrenceDate: date,
        }))
      )
      .onConflictDoNothing({
        target: [transactions.recurringTransactionId, transactions.recurringOccurrenceDate],
      })
      .returning({ transactionId: transactions.transactionId });
    created = inserted.length;

    // The lock above means this shouldn't happen: an occurrence already
    // existed, so next_run_date was behind the rows it had created (a hand
    // edit, or a writer that bypassed the lock). The UNIQUE kept the data
    // right; say so rather than let it pass unremarked.
    if (created < dates.length) {
      log.warn("recurring occurrence already existed; skipped", {
        recurring_transaction_id: template.recurring_transaction_id,
        attempted: dates.length,
        created,
      });
    }

    await rebuildAccountBalances(tx, [template.account_id, template.related_account_id]);
  }

  await tx
    .update(recurringTransactions)
    .set(pausedForClosedAccount ? { nextRunDate, isActive: false } : { nextRunDate })
    .where(eq(recurringTransactions.recurringTransactionId, template.recurring_transaction_id));

  if (pausedForClosedAccount) {
    log.warn("recurring transaction paused: its account is closed", {
      recurring_transaction_id: template.recurring_transaction_id,
      account_id: template.account_id,
    });
  }

  return { created, pausedForClosedAccount, skipped: false };
}

/**
 * The scheduler's entry point: every template due as of `today`, each in its
 * own transaction. A template that fails is reported with its id and counted,
 * and the run carries on. A throw from here means the run itself couldn't
 * start (the due list couldn't be read), and the scheduler reports that.
 */
export async function runDueTemplates(
  options: { today?: string; cap?: number; lockTimeout?: string } = {}
): Promise<RunSummary> {
  const today = options.today ?? (await currentDate());

  const due = await db.execute<{ id: number }>(sql`
    SELECT recurring_transaction_id AS id
    FROM recurring_transactions
    WHERE is_active
      AND next_run_date <= ${today}::date
      AND (end_date IS NULL OR next_run_date <= end_date)
    ORDER BY next_run_date, recurring_transaction_id
  `);

  const summary: RunSummary = { today, due: due.rows.length, created: 0, paused: 0, failed: 0 };

  for (const { id } of due.rows) {
    try {
      const outcome = await systemTransaction(
        RECURRING_SCHEDULE_ACTOR,
        (tx) => materializeTemplate(tx, id, { today, cap: options.cap }),
        { lockTimeout: options.lockTimeout ?? SCHEDULER_LOCK_TIMEOUT }
      );
      summary.created += outcome.created;
      if (outcome.pausedForClosedAccount) summary.paused += 1;
    } catch (error) {
      summary.failed += 1;
      reportError(error, { job: RECURRING_SCHEDULE_ACTOR, recurring_transaction_id: id });
    }
  }

  return summary;
}
