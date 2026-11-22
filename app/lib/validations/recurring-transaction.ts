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
  nextOccurrenceOnOrAfter,
  type Cadence,
} from "@/lib/recurring/schedule";

/**
 * Validation for the recurring-transaction actions (Issue #135), in two halves,
 * the way lib/validations/balance-transfer.ts splits them.
 *
 * `recurringTransactionFormSchema` checks what the form alone can answer: the
 * six transaction fields (shared with transactionFormSchema), the cadence, the
 * interval, the two dates, and the next date the edit form loaded. Every
 * `z.string(...)` carries an authored message (docs/input-validation.md).
 *
 * `checkRecurringSchedule` checks what needs the database: today's date, the
 * account's open/closed window, whether the other rows the template names
 * exist, and the row being edited. The action
 * (lib/actions/recurring-transaction.ts) reads those facts inside its
 * transaction and hands them over; the rules are a pure
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
    // Sent by the edit dialog only, as a hidden field: the next date it opened
    // with. A submitted next date still equal to it is one the user didn't
    // change, and the update keeps the stored one, which the scheduler may have
    // moved on since. Absent, the submitted date is compared with the stored one.
    loadedNextRunDate: z
      .string("Invalid loaded next date")
      .optional()
      .refine((val) => !val || isValidIsoDate(val), { message: "Invalid loaded next date" }),
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
  /**
   * Whether the other rows the template names exist. `relatedAccount` is true
   * when it names none.
   */
  references: { relatedAccount: boolean; transactionType: boolean; transactionCategory: boolean };
}

export interface RecurringScheduleProblem {
  field: "accountId" | "relatedAccountId" | "transactionTypeId" | "transactionCategoryId" | "nextRunDate" | "endDate";
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

/** Whether an update resumes a paused template whose next date has passed. */
function resumesLate(submitted: SubmittedSchedule, stored: StoredSchedule, today: string): boolean {
  return !isScheduleChange(submitted, stored) && !stored.isActive && submitted.isActive && stored.nextRunDate < today;
}

/**
 * The anchor and next date a save stores. A create, or a new cadence, interval
 * or next date, starts a schedule from the submitted next date. Any other edit
 * keeps the stored ones, which is what brings a monthly 31st back to the 31st
 * after a short month. Resuming a paused template skips the dates it missed
 * rather than backfilling them; a new next date in the same save is a schedule
 * change instead, and is honored as a deliberate backfill.
 */
export function resolveSchedule(
  submitted: SubmittedSchedule,
  stored: StoredSchedule | null,
  today: string
): { anchorDate: string; nextRunDate: string } {
  if (stored === null || isScheduleChange(submitted, stored)) {
    return { anchorDate: submitted.nextRunDate, nextRunDate: submitted.nextRunDate };
  }
  if (resumesLate(submitted, stored, today)) {
    const schedule = { cadence: stored.cadence, every: stored.every, anchorDate: stored.anchorDate, endDate: submitted.endDate };
    return { anchorDate: stored.anchorDate, nextRunDate: nextOccurrenceOnOrAfter(schedule, today) };
  }
  return { anchorDate: stored.anchorDate, nextRunDate: stored.nextRunDate };
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

  // Checked here rather than left to the foreign keys, whose violation would
  // reach the user as "Please try again", which a retry never fixes.
  if (!facts.references.relatedAccount) {
    problems.push({ field: "relatedAccountId", message: "Related account not found" });
  }
  if (!facts.references.transactionType) {
    problems.push({ field: "transactionTypeId", message: "Transaction type not found" });
  }
  if (!facts.references.transactionCategory) {
    problems.push({ field: "transactionCategoryId", message: "Category not found" });
  }

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

  // Extending an Ended template makes it due again from its stored next date,
  // with nothing in between created. Hold that date to the same floor, so a
  // template that ended long ago can't backfill years in one save. A paused
  // one is exempt: resuming skips the dates it missed instead.
  const reopensEnded =
    stored !== null &&
    !newSchedule &&
    stored.isActive &&
    submitted.isActive &&
    stored.endDate !== null &&
    stored.nextRunDate > stored.endDate &&
    (submitted.endDate === null || stored.nextRunDate <= submitted.endDate);

  if ((newSchedule || reopensEnded) && submitted.nextRunDate < addMonthsToDate(today, -12)) {
    problems.push({
      field: "nextRunDate",
      message: "Next date can't be more than a year in the past.",
    });
  }

  // Rows dated before the account opened never reach its balance history
  // (rebuildAccountBalance clips to opened_date). Checked against the next date
  // the save will store: a resume skips ahead, so the date it paused on is moot.
  const resumes = stored !== null && resumesLate(submitted, stored, today);
  const nextToStore = resolveSchedule(submitted, stored, today).nextRunDate;
  if (
    (newSchedule || accountChanged || resumes) &&
    account.openedDate !== null &&
    nextToStore < account.openedDate
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
    } else if (stored !== null && submitted.endDate < stored.anchorDate) {
      problems.push({
        field: "endDate",
        message: `Ends must be on or after ${stored.anchorDate}, when this schedule started.`,
      });
    }
  }

  return problems;
}
