/**
 * Recurring-transaction date math (Issue #135). Pure and DB-free, so the
 * materializer, the dialog's preview and the cash-flow forecast (#138) all
 * agree on what a schedule means.
 *
 * Two rules carry the whole module:
 *
 *   **Every occurrence is computed from the anchor, never from the previous
 *   occurrence.** Occurrence k of a monthly schedule anchored on Jan 31 is
 *   "Jan 31 plus k months, clamped to the month's last day", so the sequence is
 *   Jan 31 → Feb 28 → Mar 31. Stepping from the previous date would give
 *   Jan 31 → Feb 28 → Mar 28 and lose the 31st for good. Postgres's
 *   `anchor + make_interval(months => k)` clamps the same way.
 *
 *   **The arithmetic is integers in UTC, on `YYYY-MM-DD` strings.** No local
 *   `Date` is ever built. `new Date("2026-03-01")` parses as UTC midnight but
 *   date-fns' `addMonths` works in local time, and mixing the two is an
 *   off-by-one that appears in America/Chicago and never in a UTC CI runner
 *   (the trap lib/format/dates.ts describes). Only `setUTCFullYear` (through
 *   `utcDate()`), epoch milliseconds (`getTime()`, `new Date(ms)`), and the
 *   `getUTC*` accessors are used here, so the result cannot depend on `TZ`.
 *
 * "Today" is never decided here. Callers pass it in, and the materializer
 * passes Postgres's CURRENT_DATE, the same "today" every balance uses.
 */

export const CADENCES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const MIN_INTERVAL = 1;
export const MAX_INTERVAL = 99;

export interface Schedule {
  cadence: Cadence;
  /** "Every N" cadence units, 1–99. */
  every: number;
  /** Occurrence 0, `YYYY-MM-DD`. */
  anchorDate: string;
  /** The last date an occurrence may fall on, inclusive, or null for no end. */
  endDate: string | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * An upper bound on how many dates any one call walks. Nothing legitimate comes
 * near it: a year of a daily schedule is 366, and the materializer caps a run
 * at 400. It exists so a malformed input fails loudly rather than spinning.
 */
const WALK_LIMIT = 10_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Ymd {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

/**
 * A UTC midnight `Date`, `m0` 0-based. Not `Date.UTC`, which reads years 0–99
 * as 1900–1999, so "0050-03-01" would come back as a date in 1950.
 */
function utcDate(y: number, m0: number, d: number): Date {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m0, d);
  return dt;
}

function daysInMonth(y: number, m: number): number {
  // Day 0 of the next month is the last day of this one.
  return utcDate(y, m, 0).getUTCDate();
}

function parse(date: string): Ymd {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new RangeError(`Not a calendar date: ${date}`);
  }
  return { y, m, d };
}

function format({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toEpochDay(date: string): number {
  const { y, m, d } = parse(date);
  return utcDate(y, m - 1, d).getTime() / MS_PER_DAY;
}

function fromEpochDay(day: number): string {
  const dt = new Date(day * MS_PER_DAY);
  return format({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

/** `months` after `anchor`, with the anchor's day clamped to the target month's last day. */
function addMonthsClamped(anchor: Ymd, months: number): string {
  const total = anchor.y * 12 + (anchor.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return format({ y, m, d: Math.min(anchor.d, daysInMonth(y, m)) });
}

function assertSchedule(s: Schedule): void {
  if (!CADENCES.includes(s.cadence)) {
    throw new RangeError(`Unknown cadence: ${JSON.stringify(s.cadence)}`);
  }
  if (!Number.isInteger(s.every) || s.every < MIN_INTERVAL || s.every > MAX_INTERVAL) {
    throw new RangeError(`Interval must be a whole number from ${MIN_INTERVAL} to ${MAX_INTERVAL}: ${s.every}`);
  }
  parse(s.anchorDate);
  if (s.endDate !== null) parse(s.endDate);
}

/**
 * `date` shifted by `months` (negative for earlier), clamped the way a
 * schedule clamps: one year before 2028-02-29 is 2027-02-28.
 */
export function addMonthsToDate(date: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError(`Months must be a whole number: ${months}`);
  return addMonthsClamped(parse(date), months);
}

/** Days between occurrences for daily/weekly, or null for the month-based cadences. */
function stepDays(s: Schedule): number | null {
  if (s.cadence === "daily") return s.every;
  if (s.cadence === "weekly") return 7 * s.every;
  return null;
}

/** Months between occurrences for monthly/yearly. */
function stepMonths(s: Schedule): number {
  return s.cadence === "yearly" ? 12 * s.every : s.every;
}

/** Occurrence `k` (k ≥ 0) of the schedule, computed from the anchor. Ignores the end date. */
export function occurrenceDate(s: Schedule, k: number): string {
  assertSchedule(s);
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`Occurrence index must be a whole number ≥ 0: ${k}`);
  }
  const days = stepDays(s);
  if (days !== null) return fromEpochDay(toEpochDay(s.anchorDate) + k * days);
  return addMonthsClamped(parse(s.anchorDate), k * stepMonths(s));
}

/** The index of the first occurrence on or after `date`. 0 when `date` is on or before the anchor. */
function indexOnOrAfter(s: Schedule, date: string): number {
  const days = stepDays(s);
  if (days !== null) {
    const diff = toEpochDay(date) - toEpochDay(s.anchorDate);
    return diff <= 0 ? 0 : Math.ceil(diff / days);
  }
  // Occurrence k always lands in calendar month (anchor month + k·step), so the
  // month difference finds the candidate and one comparison settles the day.
  const a = parse(s.anchorDate);
  const t = parse(date);
  const monthDiff = (t.y - a.y) * 12 + (t.m - a.m);
  if (monthDiff < 0) return 0;
  const k = Math.floor(monthDiff / stepMonths(s));
  return occurrenceDate(s, k) >= date ? k : k + 1;
}

/** Whether `date` is itself an occurrence of the schedule (end date ignored). */
export function isOccurrence(s: Schedule, date: string): boolean {
  parse(date);
  return occurrenceDate(s, indexOnOrAfter(s, date)) === date;
}

/**
 * The first occurrence on or after `date`, end date ignored. What resuming a
 * paused template rolls next_run_date forward to, so the dates it was paused
 * for are skipped rather than backfilled.
 */
export function nextOccurrenceOnOrAfter(s: Schedule, date: string): string {
  assertSchedule(s);
  parse(date);
  return occurrenceDate(s, indexOnOrAfter(s, date));
}

/** Whether `date` falls after the schedule's end. */
export function isPastEnd(s: Schedule, date: string): boolean {
  return s.endDate !== null && date > s.endDate;
}

/**
 * The occurrences due as of `today`, starting at `next`: every one on or before
 * both `today` and the end date, at most `cap` of them. `next` comes back as
 * the first occurrence *not* returned, which is what next_run_date becomes.
 * When the cap stops the walk, that is still on or before `today`, and the
 * next run carries on from it.
 *
 * `next` must be an occurrence of the schedule. That is the table's invariant,
 * and a row that breaks it fails here loudly rather than being silently
 * re-anchored.
 */
export function dueOccurrences(
  s: Schedule,
  next: string,
  today: string,
  cap: number
): { dates: string[]; next: string } {
  assertSchedule(s);
  parse(today);
  if (!Number.isInteger(cap) || cap < 1) throw new RangeError(`Cap must be a whole number ≥ 1: ${cap}`);
  let k = indexOnOrAfter(s, next);
  if (occurrenceDate(s, k) !== next) {
    throw new RangeError(`${next} is not an occurrence of the schedule anchored on ${s.anchorDate}`);
  }
  const dates: string[] = [];
  let date = next;
  while (dates.length < cap && date <= today && !isPastEnd(s, date)) {
    dates.push(date);
    k += 1;
    date = occurrenceDate(s, k);
  }
  return { dates, next: date };
}

/**
 * How many occurrences from `next` fall on or before `through` and the end
 * date. The dialog uses it to say how many transactions a save will add at
 * once. Like `dueOccurrences`, it refuses a `next` that isn't an occurrence,
 * so the count is never one the materializer wouldn't produce.
 */
export function countOccurrencesThrough(s: Schedule, next: string, through: string): number {
  assertSchedule(s);
  parse(through);
  let k = indexOnOrAfter(s, next);
  if (occurrenceDate(s, k) !== next) {
    throw new RangeError(`${next} is not an occurrence of the schedule anchored on ${s.anchorDate}`);
  }
  let count = 0;
  for (let date = occurrenceDate(s, k); date <= through && !isPastEnd(s, date); date = occurrenceDate(s, ++k)) {
    count += 1;
    if (count > WALK_LIMIT) throw new RangeError("Too many occurrences to count");
  }
  return count;
}

/**
 * Up to `count` occurrences from `from` onward, inclusive, stopping at the end
 * date. `count` is a whole number ≥ 0, so `Infinity` is refused rather than
 * read as "all of them": a schedule with no end has no last date.
 */
export function nextOccurrences(s: Schedule, from: string, count: number): string[] {
  assertSchedule(s);
  parse(from);
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Count must be a whole number ≥ 0: ${count}`);
  const dates: string[] = [];
  let k = indexOnOrAfter(s, from);
  while (dates.length < Math.min(count, WALK_LIMIT)) {
    const date = occurrenceDate(s, k);
    if (isPastEnd(s, date)) break;
    dates.push(date);
    k += 1;
  }
  return dates;
}

/**
 * Every occurrence in `[from, to]`, both inclusive, that is on or before the
 * end date. For the cash-flow forecast (#138), which projects a template over a
 * window without reading the rows it has created.
 */
export function occurrencesBetween(s: Schedule, from: string, to: string): string[] {
  assertSchedule(s);
  parse(from);
  parse(to);
  const dates: string[] = [];
  let k = indexOnOrAfter(s, from);
  for (let date = occurrenceDate(s, k); date <= to && !isPastEnd(s, date); date = occurrenceDate(s, ++k)) {
    dates.push(date);
    if (dates.length > WALK_LIMIT) throw new RangeError("Too many occurrences in range");
  }
  return dates;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The fewest days each month can have: February's 28. */
const MIN_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "day"/"days", "week"/"weeks"… for the dialog's "Every N ___" label. */
export function cadenceUnit(cadence: Cadence, every: number): string {
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[cadence];
  return every === 1 ? unit : `${unit}s`;
}

/**
 * The schedule as a person would say it: "Monthly on the 31st (or the last
 * day)", "Every 2 weeks on Friday", "Yearly on February 29 (February 28 in
 * other years)". The end date is not part of it; the list shows that
 * separately.
 */
export function describeSchedule(s: Schedule): string {
  assertSchedule(s);
  const a = parse(s.anchorDate);
  const lead = (single: string) =>
    s.every === 1 ? single : `Every ${s.every} ${cadenceUnit(s.cadence, s.every)}`;

  switch (s.cadence) {
    case "daily":
      return lead("Daily");
    case "weekly": {
      const weekday = WEEKDAYS[utcDate(a.y, a.m - 1, a.d).getUTCDay()];
      return `${lead("Weekly")} on ${weekday}`;
    }
    case "monthly": {
      // Only when some month the schedule lands in can be shorter than the
      // anchor's day: every 12 months from Jan 31 is always a Jan 31.
      const visited = Array.from({ length: 12 }, (_, k) => (a.m - 1 + k * s.every) % 12);
      const clamp = visited.some((m) => MIN_DAYS_IN_MONTH[m] < a.d) ? " (or the last day)" : "";
      return `${lead("Monthly")} on the ${ordinal(a.d)}${clamp}`;
    }
    case "yearly": {
      const leap = a.m === 2 && a.d === 29 ? " (February 28 in other years)" : "";
      return `${lead("Yearly")} on ${MONTHS[a.m - 1]} ${a.d}${leap}`;
    }
  }
}
