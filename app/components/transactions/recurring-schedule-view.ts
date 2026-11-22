import {
  CADENCES,
  MAX_INTERVAL,
  MIN_INTERVAL,
  countOccurrencesThrough,
  isOccurrence,
  nextOccurrenceOnOrAfter,
  nextOccurrences,
  type Cadence,
  type Schedule,
} from "@/lib/recurring/schedule";

/**
 * What the Recurring tab shows about a template's schedule (Issue #135): its
 * status, and the dialog's live preview of what a save will do. Pure, so every
 * case is unit-tested. Which anchor and next date a save keeps mirrors
 * resolveSchedule() in lib/validations/recurring-transaction.ts, and a test
 * holds the two equal. It isn't imported from there, which would bring zod
 * into the client bundle. The count is what the materializer adds for a save
 * the action accepts. Refusals aren't previewed: the save says why it refused.
 */

export type RecurringStatus = "active" | "ended" | "paused" | "paused-account-closed" | "account-closed";

export const STATUS_LABELS: Record<RecurringStatus, string> = {
  active: "Active",
  ended: "Ended",
  paused: "Paused",
  "paused-account-closed": "Paused — account closed",
  "account-closed": "Account closed",
};

/**
 * Ended first, since a template past its end date does nothing whether it's
 * paused or not. Then a closed account, which explains a pause the scheduler
 * made itself.
 *
 * "Account closed" is a fifth status beside the spec's four. It's an active
 * template on a closed account, which still creates the dates before the close
 * date, then pauses at its first due date on or after it. Until then, which can
 * be a whole cadence away, it neither runs freely nor has paused. A close date
 * counts once it's set, even a future one, as it does when the save refuses to
 * activate a template on that account.
 */
export function recurringStatus(t: {
  isActive: boolean;
  nextRunDate: string;
  endDate: string | null;
  accountClosedDate: string | null;
}): RecurringStatus {
  if (t.endDate !== null && t.nextRunDate > t.endDate) return "ended";
  if (!t.isActive) return t.accountClosedDate !== null ? "paused-account-closed" : "paused";
  if (t.accountClosedDate !== null) return "account-closed";
  return "active";
}

/** The dialog's fields, as typed so far. */
export interface PreviewInput {
  cadence: string;
  intervalCount: string;
  nextRunDate: string;
  endDate: string;
  isActive: boolean;
  /** The row being edited, or null when adding. */
  stored: {
    cadence: Cadence;
    intervalCount: number;
    anchorDate: string;
    nextRunDate: string;
    isActive: boolean;
  } | null;
  /**
   * Postgres's CURRENT_DATE as the page read it (`currentDate()` in
   * lib/recurring/materialize.ts), the "today" the save uses. Then the count
   * agrees with the save's "N transactions added" message, which the viewer's
   * local date wouldn't in a US evening, when it's already tomorrow in UTC.
   */
  today: string;
}

export type Preview =
  | { kind: "incomplete" }
  | { kind: "paused" }
  | { kind: "scheduled"; dueNow: number; upcoming: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * What saving would do: how many occurrences dated on or before today it adds
 * at once, and the next few after today. "incomplete" until the fields make a
 * schedule. Follows the action: an unchanged schedule keeps its anchor, and
 * resuming without a new next date skips the dates missed while paused.
 */
export function previewSchedule(input: PreviewInput): Preview {
  const every = Number(input.intervalCount);
  if (
    !(CADENCES as readonly string[]).includes(input.cadence) ||
    !/^\d{1,2}$/.test(input.intervalCount) ||
    every < MIN_INTERVAL ||
    every > MAX_INTERVAL ||
    !ISO_DATE.test(input.nextRunDate) ||
    (input.endDate !== "" && !ISO_DATE.test(input.endDate)) ||
    !ISO_DATE.test(input.today)
  ) {
    return { kind: "incomplete" };
  }
  if (!input.isActive) return { kind: "paused" };

  const cadence = input.cadence as Cadence;
  const { stored } = input;
  const scheduleChanged =
    stored === null ||
    cadence !== stored.cadence ||
    every !== stored.intervalCount ||
    input.nextRunDate !== stored.nextRunDate;

  try {
    const schedule: Schedule = {
      cadence,
      every,
      anchorDate: scheduleChanged ? input.nextRunDate : stored.anchorDate,
      endDate: input.endDate === "" ? null : input.endDate,
    };
    let next = scheduleChanged ? input.nextRunDate : stored.nextRunDate;
    if (!scheduleChanged && !stored.isActive && next < input.today) {
      next = nextOccurrenceOnOrAfter(schedule, input.today);
    }
    if (!isOccurrence(schedule, next)) return { kind: "incomplete" };

    const dueNow = countOccurrencesThrough(schedule, next, input.today);
    const from = next > input.today ? next : nextDay(input.today);
    return { kind: "scheduled", dueNow, upcoming: nextOccurrences(schedule, from, 3) };
  } catch {
    // A date that matches the pattern but isn't a calendar date (Feb 30), or a
    // backfill too long to count: the form's own validation says which.
    return { kind: "incomplete" };
  }
}
