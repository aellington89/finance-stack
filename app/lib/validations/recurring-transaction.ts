import { z } from "zod/v4";
import { isValidIsoDate } from "@/lib/validations/date-range";
import {
  relatedAccountDiffers,
  relatedAccountDiffersParams,
  transactionFieldShapes,
} from "@/lib/validations/transaction";
import {
  CADENCES,
  MAX_INTERVAL,
  MIN_INTERVAL,
  addMonthsToDate,
  type Cadence,
} from "@/lib/recurring/schedule";

/**
 * Validation for the recurring-transaction actions (Issue #135), in two halves,
 * the way lib/validations/balance-transfer.ts splits them.
 *
 * `recurringTransactionFormSchema` checks what the form alone can answer: the
 * six transaction fields (shared with transactionFormSchema), the cadence, the
 * interval and the two dates. Every `z.string(...)` carries an authored message
 * (docs/input-validation.md).
 *
 * `checkRecurringSchedule` checks what needs the database: today's date, the
 * account's open/closed window, and the row being edited. The action reads
 * those facts inside its transaction and hands them over; the rules are a pure
 * function, so every message is unit-tested without a database.
 */

const INTERVAL_MESSAGE = `Repeat every ${MIN_INTERVAL} to ${MAX_INTERVAL}`;

export const recurringTransactionFormSchema = z
  .object({
    ...transactionFieldShapes,
    cadence: z.enum(CADENCES, "Choose how often it repeats"),
    intervalCount: z
      .string(INTERVAL_MESSAGE)
      .regex(/^\d{1,2}$/, INTERVAL_MESSAGE)
      .refine((val) => Number(val) >= MIN_INTERVAL, { message: INTERVAL_MESSAGE }),
    nextRunDate: z
      .string("Next date is required")
      .min(1, "Next date is required")
      .refine(isValidIsoDate, {
        message: "Next date must be a valid date in YYYY-MM-DD format",
      }),
    // Absent or empty means "no end".
    endDate: z
      .string("Invalid end date")
      .optional()
      .refine((val) => !val || isValidIsoDate(val), {
        message: "End date must be a valid date in YYYY-MM-DD format",
      }),
    // Sent by the edit dialog only, as a hidden "true"/"false". Create always
    // makes an active template; an update without it keeps the stored value.
    isActive: z.enum(["true", "false"], "Invalid active setting").optional(),
  })
  .refine(relatedAccountDiffers, relatedAccountDiffersParams());

export type RecurringTransactionFormData = z.infer<typeof recurringTransactionFormSchema>;

/** The schedule as submitted, parsed. */
export interface SubmittedSchedule {
  cadence: Cadence;
  every: number;
  nextRunDate: string;
  endDate: string | null;
  isActive: boolean;
  accountId: number;
}

/** The row being edited, as stored. */
export interface StoredSchedule {
  cadence: Cadence;
  every: number;
  anchorDate: string;
  nextRunDate: string;
  endDate: string | null;
  isActive: boolean;
  accountId: number;
}

export interface RecurringScheduleFacts {
  submitted: SubmittedSchedule;
  /** `null` on create. */
  stored: StoredSchedule | null;
  /** Postgres's CURRENT_DATE, read inside the action's transaction. */
  today: string;
  /** The submitted account, or `null` when it doesn't exist. */
  account: { openedDate: string | null; closedDate: string | null } | null;
}

export interface RecurringScheduleProblem {
  field: "accountId" | "nextRunDate" | "endDate";
  message: string;
}

/**
 * Whether an update starts a new schedule: a different cadence, interval or
 * next date. Then the anchor moves to the new next date. Anything else (the
 * description, the amount, the end date, pausing) keeps the anchor, which is
 * what keeps a monthly 31st returning to the 31st after a short month.
 */
export function isScheduleChange(submitted: SubmittedSchedule, stored: StoredSchedule): boolean {
  return (
    submitted.cadence !== stored.cadence ||
    submitted.every !== stored.every ||
    submitted.nextRunDate !== stored.nextRunDate
  );
}

/**
 * The rules that need the database, as authored messages keyed by field.
 * Returns an empty list when the save is valid.
 *
 * The next-date rules apply only to a next date the user chose: on create, or
 * when the schedule changed. An untouched next date is the scheduler's, and an
 * Ended template (next date past its end) has to stay editable, so the end date
 * is then held only to the database's own rule, end ≥ anchor.
 */
export function checkRecurringSchedule(facts: RecurringScheduleFacts): RecurringScheduleProblem[] {
  const { submitted, stored, today, account } = facts;

  if (account === null) {
    return [{ field: "accountId", message: "Account not found" }];
  }

  const problems: RecurringScheduleProblem[] = [];

  // A paused template may sit on a closed account (the scheduler pauses it
  // there itself), and can still be renamed or deleted. It can't run there.
  if (account.closedDate !== null && submitted.isActive) {
    problems.push({
      field: "accountId",
      message: "This account is closed. Pick an open account, or leave the recurring transaction paused.",
    });
  }

  const newSchedule = stored === null || isScheduleChange(submitted, stored);
  const accountChanged = stored !== null && submitted.accountId !== stored.accountId;

  if (newSchedule && submitted.nextRunDate < addMonthsToDate(today, -12)) {
    problems.push({
      field: "nextRunDate",
      message: "Next date can't be more than a year in the past.",
    });
  }

  // Rows dated before the account opened never reach its balance history
  // (rebuildAccountBalance clips to opened_date).
  if (
    (newSchedule || accountChanged) &&
    account.openedDate !== null &&
    submitted.nextRunDate < account.openedDate
  ) {
    problems.push({
      field: "nextRunDate",
      message: "Next date is before this account was opened.",
    });
  }

  if (submitted.endDate !== null) {
    if (newSchedule) {
      if (submitted.endDate < submitted.nextRunDate) {
        problems.push({ field: "endDate", message: "Ends must be on or after Next date." });
      }
    } else if (submitted.endDate < stored!.anchorDate) {
      problems.push({
        field: "endDate",
        message: `Ends must be on or after ${stored!.anchorDate}, when this schedule started.`,
      });
    }
  }

  return problems;
}
