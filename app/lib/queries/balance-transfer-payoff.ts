import {
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  parseISO,
  subMonths,
} from "date-fns";

/**
 * The payoff math behind the Liabilities drilldown's Balance transfers card
 * (Issue #417).
 *
 * Kept apart from balance-transfers.ts, and free of any database import, so
 * the unit project can reach every boundary directly, the same way
 * asset-performance.ts is. getActiveBalanceTransfers() is two queries plus
 * calls into this module: balanceProbes() says which balances the second
 * query must fetch, and buildBalanceTransferTracker() does the rest.
 *
 * Sign convention. Card balances keep the ledger's sign (negative = owed), as
 * everywhere in the liabilities layer. Everything this module derives from them
 * is a magnitude: `debt` is what is owed, a pace is positive when the debt is
 * falling, and transferred and fee amounts are shown as their absolute values.
 *
 * The card is the unit of the payoff math. Balance, pace and required paydown
 * come from the card's balance history, which cannot be split between two
 * promos on the same card. A card carrying several active transfers therefore
 * gets one tracker row, whose deadline is its earliest-ending promo. Its later
 * transfers ride along as `others`, showing their own terms only. Otherwise
 * each row would restate the same whole-card balance and the required
 * paydowns would double-count.
 *
 * v1 limitation, carried from the issue. While a promo is active, the card's
 * whole balance counts as promotional, including purchases at the standard
 * APR. The required paydown is therefore conservative for a card that is
 * also used for purchases.
 */

// ── Inputs ─────────────────────────────────────────────────────────────

/**
 * One active transfer, as getActiveBalanceTransfers' first query returns it.
 * Dates are `YYYY-MM-DD`. `asOf` comes from Postgres, so this module never
 * decides what "today" is.
 *
 * A `type` rather than an `interface`, as AssetPerformanceRow is, so the query
 * can cast `db.execute`'s rows to it.
 */
export type ActiveTransferRow = {
  balanceTransferId: number;
  accountId: number;
  accountName: string;
  postingTransactionId: number;
  postingDate: string;
  /** Ledger sign: negative, because the posting added debt to the card. */
  postingAmount: number;
  sourceAccountName: string | null;
  promoEndDate: string;
  promoApr: number;
  /** NULL when no fee is linked, or the linked fee is now on another account. */
  feeTransactionId: number | null;
  feeAmount: number | null;
  feeDate: string | null;
  /** The card's cumulative balance on `asOf`, ledger sign. */
  balance: number;
  asOf: string;
};

/** A ledger amount that must not count as paydown or as falling behind. */
export interface LinkedPosting {
  date: string;
  amount: number;
}

// ── Outputs ────────────────────────────────────────────────────────────

export type TrackerStatus =
  | { kind: "on_track" }
  | { kind: "behind"; shortPerMonth: number }
  | { kind: "expiring"; daysLeft: number }
  | { kind: "too_new" };

/** One transfer's own terms, as magnitudes for display. */
export interface TransferTerms {
  balanceTransferId: number;
  sourceAccountName: string | null;
  postingDate: string;
  transferredAmount: number;
  promoEndDate: string;
  promoApr: number;
  feeAmount: number | null;
}

export interface BalanceTransferTrackerRow {
  accountId: number;
  accountName: string;
  asOf: string;
  /** The card's balance on `asOf`, ledger sign. */
  balance: number;
  /** What is owed: `max(0, -balance)`. */
  debt: number;
  /** The earliest-ending active transfer, which sets the deadline. */
  primary: TransferTerms;
  /** The card's other active transfers, by end date. Usually empty. */
  others: TransferTerms[];
  monthsRemaining: number;
  daysLeft: number;
  /** Interest per month at the promo APR. `null` at 0%. */
  monthlyInterest: number | null;
  requiredPerMonth: number;
  /** Net paydown per month over the trailing 3 months. `null` = "—". */
  threeMonthPace: number | null;
  /** Net paydown per month over the selected range. `null` = "—". */
  rangePace: number | null;
  /** Debt left at expiry at the 3-month pace. `null` when that pace is. */
  projectedAtExpiry: number | null;
  status: TrackerStatus;
}

// ── Constants ──────────────────────────────────────────────────────────

/** Average days per month, used to turn a window's change into a monthly rate. */
export const DAYS_PER_MONTH = 30.44;

/**
 * A pace from a shorter window is noise: a week with one payment in it reads
 * as a huge monthly rate, and a week without one reads as zero. Both windows
 * show "—" below this.
 */
export const MIN_PACE_WINDOW_DAYS = 30;

/** At or inside this many days, the status is "Expires in N days". */
export const EXPIRY_WARNING_DAYS = 90;

/** Half a cent: the smallest amount that still rounds to a displayed cent. */
const CENT_EPSILON = 0.005;

// ── Date helpers ───────────────────────────────────────────────────────

const toDate = (iso: string): Date => parseISO(iso);
const toIso = (d: Date): string => format(d, "yyyy-MM-dd");

/** The later of two `YYYY-MM-DD` dates. They compare lexically. */
const laterOf = (a: string, b: string): string => (a > b ? a : b);

/**
 * Calendar months from `asOf` until `promoEndDate`, rounded up, minimum 1: the
 * smallest n with `asOf + n months >= promoEndDate`. date-fns clamps to the end
 * of a shorter month, so Jan 31 + 1 month is Feb 28 (or 29).
 */
export function monthsRemaining(asOf: string, promoEndDate: string): number {
  const from = toDate(asOf);
  const end = toDate(promoEndDate);
  // The answer is always the calendar-month difference k or k + 1, so the
  // loop runs at most a couple of times from here.
  let n = Math.max(1, differenceInCalendarMonths(end, from) - 1);
  while (addMonths(from, n) < end) n++;
  return n;
}

/**
 * Days from `asOf` until `promoEndDate`. The end day is not part of the promo,
 * so an active promo always has at least 1.
 */
export function daysRemaining(asOf: string, promoEndDate: string): number {
  return differenceInCalendarDays(toDate(promoEndDate), toDate(asOf));
}

/**
 * Where each pace window starts. Both end on `asOf`.
 *
 * - The 3-month window covers the trailing 3 calendar months, or runs from
 *   when the card became promotional if that is shorter.
 * - The range window covers the selected range, or also runs from the posting
 *   if that is later.
 *
 * `promotionalSince` is the earliest posting date among the card's active
 * transfers.
 */
export function paceWindowStarts(
  asOf: string,
  dateFrom: string,
  promotionalSince: string
): { threeMonth: string; range: string } {
  return {
    threeMonth: laterOf(toIso(subMonths(toDate(asOf), 3)), promotionalSince),
    range: laterOf(dateFrom, promotionalSince),
  };
}

/**
 * The card's net balance change over [start, end] as a monthly rate. It is
 * positive when the debt fell, and it comes from balance history, so new
 * purchases count against it.
 *
 * Linked postings dated in (start, end] are taken back out: the transfer
 * arriving and its fee posting are not the user falling behind. The interval
 * is open at the start because `startBalance` is the cumulative balance at the
 * end of `start`, which already includes anything posted that day. A posting
 * on the start day is therefore already outside the change.
 *
 * Returns `null` (shown as "—") for a window shorter than `minDays`, or when
 * the start date has no balance row.
 */
export function monthlyPace(input: {
  startBalance: number | null;
  endBalance: number;
  start: string;
  end: string;
  linked: readonly LinkedPosting[];
  minDays?: number;
}): number | null {
  const { startBalance, endBalance, start, end, linked } = input;
  const minDays = input.minDays ?? MIN_PACE_WINDOW_DAYS;
  const days = differenceInCalendarDays(toDate(end), toDate(start));
  if (startBalance === null || days < minDays || days <= 0) return null;
  const linkedInWindow = linked
    .filter((l) => l.date > start && l.date <= end)
    .reduce((sum, l) => sum + l.amount, 0);
  const change = endBalance - startBalance - linkedInWindow;
  return (change / days) * DAYS_PER_MONTH;
}

/** The nominal monthly rate for an APR in percent: 3.99 → 0.003325. */
export const monthlyRate = (apr: number): number => apr / 100 / 12;

/**
 * The monthly payment that clears `debt` in `months` at `apr`.
 *
 * At 0% that is `debt / months`. Above it, it is the standard amortized
 * payment `debt * r / (1 - (1 + r)^-n)`. The rate is nominal monthly
 * (APR / 12), a planning approximation: issuers compound daily on the average
 * daily balance.
 */
export function requiredPayment(
  debt: number,
  apr: number,
  months: number
): number {
  if (debt <= 0) return 0;
  const r = monthlyRate(apr);
  if (r === 0) return debt / months;
  return (debt * r) / (1 - Math.pow(1 + r, -months));
}

/**
 * The debt left after `months` at a net paydown of `netPace`, clamped at zero.
 *
 * The pace is a *net* balance change, and interest already charged in its
 * window is netted out of it. So it is turned back into a gross payment by
 * adding the interest the current debt accrues each month (`debt * r`). That
 * payment is then run forward at the promo rate. At 0% this is exactly
 * `debt - netPace * months`.
 */
export function projectedDebt(
  debt: number,
  apr: number,
  months: number,
  netPace: number
): number {
  const r = monthlyRate(apr);
  if (r === 0) return Math.max(0, debt - netPace * months);
  const gross = netPace + debt * r;
  const growth = Math.pow(1 + r, months);
  return Math.max(0, debt * growth - (gross * (growth - 1)) / r);
}

/**
 * The status shown in the card's last column, first match wins:
 *
 * 1. Nothing owed: on track.
 * 2. 90 days or fewer left: "Expires in N days", whatever the pace. The
 *    projection column still shows what would be left.
 * 3. No 3-month pace yet: too new to project.
 * 4. The implied gross payment falls short of the required one by at least a
 *    cent: behind, short by that much a month.
 * 5. Otherwise on track.
 */
export function trackerStatus(input: {
  debt: number;
  daysLeft: number;
  apr: number;
  requiredPerMonth: number;
  threeMonthPace: number | null;
}): TrackerStatus {
  const { debt, daysLeft, apr, requiredPerMonth, threeMonthPace } = input;
  if (debt < CENT_EPSILON) return { kind: "on_track" };
  if (daysLeft <= EXPIRY_WARNING_DAYS) return { kind: "expiring", daysLeft };
  if (threeMonthPace === null) return { kind: "too_new" };
  const gross = threeMonthPace + debt * monthlyRate(apr);
  const short = requiredPerMonth - gross;
  if (short >= CENT_EPSILON) return { kind: "behind", shortPerMonth: short };
  return { kind: "on_track" };
}

// ── Assembly ───────────────────────────────────────────────────────────

/** The key the start-balance map is looked up by. */
export const balanceKey = (accountId: number, date: string): string =>
  `${accountId}:${date}`;

/** Each card's active transfers, earliest end date first. Ties go by id. */
function groupByCard(
  rows: readonly ActiveTransferRow[]
): ActiveTransferRow[][] {
  const byCard = new Map<number, ActiveTransferRow[]>();
  for (const row of rows) {
    const list = byCard.get(row.accountId) ?? [];
    list.push(row);
    byCard.set(row.accountId, list);
  }
  return Array.from(byCard.values()).map((list) =>
    [...list].sort(
      (a, b) =>
        a.promoEndDate.localeCompare(b.promoEndDate) ||
        a.balanceTransferId - b.balanceTransferId
    )
  );
}

const promotionalSince = (card: readonly ActiveTransferRow[]): string =>
  card.reduce(
    (earliest, t) => (t.postingDate < earliest ? t.postingDate : earliest),
    card[0].postingDate
  );

/**
 * The `(account, date)` balances the second query must fetch: each card's
 * two window starts. Nothing is returned when no transfer is active, so the
 * query can be skipped outright.
 */
export function balanceProbes(
  rows: readonly ActiveTransferRow[],
  dateFrom: string
): { accountId: number; date: string }[] {
  const probes = new Map<string, { accountId: number; date: string }>();
  for (const card of groupByCard(rows)) {
    const { accountId, asOf } = card[0];
    const starts = paceWindowStarts(asOf, dateFrom, promotionalSince(card));
    for (const date of [starts.threeMonth, starts.range]) {
      probes.set(balanceKey(accountId, date), { accountId, date });
    }
  }
  return Array.from(probes.values());
}

const termsOf = (row: ActiveTransferRow): TransferTerms => ({
  balanceTransferId: row.balanceTransferId,
  sourceAccountName: row.sourceAccountName,
  postingDate: row.postingDate,
  transferredAmount: Math.abs(row.postingAmount),
  promoEndDate: row.promoEndDate,
  promoApr: row.promoApr,
  feeAmount: row.feeAmount === null ? null : Math.abs(row.feeAmount),
});

/** Every active transfer's posting and linked fee on one card. */
const linkedPostings = (card: readonly ActiveTransferRow[]): LinkedPosting[] =>
  card.flatMap((t) => {
    const linked: LinkedPosting[] = [
      { date: t.postingDate, amount: t.postingAmount },
    ];
    if (t.feeDate !== null && t.feeAmount !== null) {
      linked.push({ date: t.feeDate, amount: t.feeAmount });
    }
    return linked;
  });

/**
 * One tracker row per card with an active promo, soonest deadline first.
 *
 * `startBalances` holds the balances balanceProbes() asked for, keyed by
 * balanceKey(). A probe with no balance row makes that pace `null`.
 */
export function buildBalanceTransferTracker(
  rows: readonly ActiveTransferRow[],
  startBalances: ReadonlyMap<string, number>,
  dateFrom: string
): BalanceTransferTrackerRow[] {
  const tracker = groupByCard(rows).map((card) => {
    const [primaryRow, ...otherRows] = card;
    const { accountId, accountName, asOf, balance } = primaryRow;
    const debt = Math.max(0, -balance);
    const apr = primaryRow.promoApr;

    const months = monthsRemaining(asOf, primaryRow.promoEndDate);
    const daysLeft = daysRemaining(asOf, primaryRow.promoEndDate);
    const starts = paceWindowStarts(asOf, dateFrom, promotionalSince(card));
    const linked = linkedPostings(card);
    const startBalance = (date: string) =>
      startBalances.get(balanceKey(accountId, date)) ?? null;

    const threeMonthPace = monthlyPace({
      startBalance: startBalance(starts.threeMonth),
      endBalance: balance,
      start: starts.threeMonth,
      end: asOf,
      linked,
    });
    const rangePace = monthlyPace({
      startBalance: startBalance(starts.range),
      endBalance: balance,
      start: starts.range,
      end: asOf,
      linked,
    });

    const requiredPerMonth = requiredPayment(debt, apr, months);

    return {
      accountId,
      accountName,
      asOf,
      balance,
      debt,
      primary: termsOf(primaryRow),
      others: otherRows.map(termsOf),
      monthsRemaining: months,
      daysLeft,
      monthlyInterest: apr > 0 ? debt * monthlyRate(apr) : null,
      requiredPerMonth,
      threeMonthPace,
      rangePace,
      projectedAtExpiry:
        threeMonthPace === null
          ? null
          : projectedDebt(debt, apr, months, threeMonthPace),
      status: trackerStatus({
        debt,
        daysLeft,
        apr,
        requiredPerMonth,
        threeMonthPace,
      }),
    };
  });

  return tracker.sort(
    (a, b) =>
      a.primary.promoEndDate.localeCompare(b.primary.promoEndDate) ||
      a.accountId - b.accountId
  );
}
