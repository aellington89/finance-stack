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
 * (Issues #417 and #427).
 *
 * Kept apart from balance-transfers.ts, and free of any database import, so
 * the unit project can reach every boundary directly, the same way
 * asset-performance.ts is. getActiveTransferBalances() is two queries plus
 * calls into this module: historyStarts() says where the second query starts
 * reading each card's balance history, and splitActiveTransfers() works out
 * what is left on each transfer. buildBalanceTransferTracker() turns that into
 * the card's rows.
 *
 * Sign convention. Card balances keep the ledger's sign (negative = owed), as
 * everywhere in the liabilities layer. Everything this module derives from them
 * is a magnitude: `owed` is what is left on a transfer, a pace is positive when
 * the debt is falling, and transferred and fee amounts are shown as their
 * absolute values.
 *
 * The transfer is the unit of the tracker (Issue #427). splitCardBalance()
 * divides the card's debt between its active transfers and its non-promo debt
 * by replaying the card's balance history, so each transfer gets its own row:
 * its own deadline, what is left on it, and what the card must pay to clear it
 * in time, counting the debt that is paid ahead of it. Pace stays a fact about
 * the card, repeated on each of its rows. Before #427 a card had one row, keyed
 * to its earliest-ending promo, so a promo already paid off still set the
 * card's deadline.
 *
 * Known limitation. The split models how an issuer allocates payments. It is
 * not the issuer's own figures: issuers send the minimum payment to the
 * lowest-APR balance, they may split payments between equal-APR promos
 * differently, and non-promo debt is projected here at the promo APR, because
 * the card's standard APR isn't recorded yet (#110). Where a statement shows
 * per-promo balances, those are authoritative.
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
  /** The card's account type. */
  accountTypeId: number;
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

/**
 * An active transfer with its share of the card's debt, as
 * getActiveTransferBalances() returns it. Both figures are magnitudes.
 */
export type ActiveTransfer = ActiveTransferRow & {
  /** What is left on this transfer. */
  owed: number;
  /**
   * What payments reach before this transfer: the card's non-promo debt, plus
   * what is left on its transfers that end sooner.
   */
  aheadOfIt: number;
};

/** A ledger amount that must not count as paydown or as falling behind. */
export interface LinkedPosting {
  date: string;
  amount: number;
}

// ── Outputs ────────────────────────────────────────────────────────────

export type TrackerStatus =
  | { kind: "paid_off" }
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

/**
 * One tracker row: one active transfer. A card's rows are adjacent, in payoff
 * order. A paid-off transfer keeps its row until its promo ends, with `null`
 * for every figure that has nothing left to measure.
 */
export interface BalanceTransferTrackerRow {
  accountId: number;
  accountName: string;
  accountTypeId: number;
  asOf: string;
  transfer: TransferTerms;
  /** What is left on this transfer. */
  owed: number;
  /** Paid ahead of it: non-promo debt and earlier-ending transfers. */
  aheadOfIt: number;
  /** Until this transfer's own end date. */
  monthsRemaining: number;
  daysLeft: number;
  /** Interest per month on `owed` at the promo APR. `null` at 0% or paid off. */
  monthlyInterest: number | null;
  /**
   * What the card must pay each month to clear this transfer by its end date,
   * counting `aheadOfIt`. `null` (shown as "—") once it is paid off. The
   * card's actual requirement is the largest of its rows.
   */
  requiredPerMonth: number | null;
  /** The card's net paydown per month over the trailing 3 months. `null` = "—". */
  threeMonthPace: number | null;
  /** The card's net paydown per month over the selected range. `null` = "—". */
  rangePace: number | null;
  /**
   * What of this transfer would revert at expiry, at the 3-month pace, once
   * what is ahead of it is paid. `null` when that pace is, or when paid off.
   */
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
 * The status shown in a row's last column, first match wins:
 *
 * 1. Nothing left on this transfer: paid off (Issue #427).
 * 2. 90 days or fewer left: "Expires in N days", whatever the pace. The
 *    projection column still shows what would be left.
 * 3. No 3-month pace yet: too new to project.
 * 4. The implied gross payment falls short of the required one by at least a
 *    cent: behind, short by that much a month.
 * 5. Otherwise on track.
 *
 * `debt` is what must be paid by this transfer's end date: what is left on it
 * plus what is paid ahead of it. The gross payment is the pace plus a month's
 * interest on that, not on the whole card. Interest on the card's later
 * transfers is a new charge, which lands in non-promo debt ahead of this one,
 * so it uses up exactly that share of the payment.
 */
export function trackerStatus(input: {
  owed: number;
  debt: number;
  daysLeft: number;
  apr: number;
  requiredPerMonth: number;
  threeMonthPace: number | null;
}): TrackerStatus {
  const { owed, debt, daysLeft, apr, requiredPerMonth, threeMonthPace } = input;
  if (owed < CENT_EPSILON) return { kind: "paid_off" };
  if (daysLeft <= EXPIRY_WARNING_DAYS) return { kind: "expiring", daysLeft };
  if (threeMonthPace === null) return { kind: "too_new" };
  const gross = threeMonthPace + debt * monthlyRate(apr);
  const short = requiredPerMonth - gross;
  if (short >= CENT_EPSILON) return { kind: "behind", shortPerMonth: short };
  return { kind: "on_track" };
}

// ── The balance split ──────────────────────────────────────────────────

/** One day of a card's balance history: `cumulative_balance`, ledger sign. */
export interface BalancePoint {
  date: string;
  balance: number;
}

/** What the split needs to know about one active transfer. */
export type SplitTransfer = Pick<
  ActiveTransferRow,
  | "balanceTransferId"
  | "postingDate"
  | "postingAmount"
  | "feeDate"
  | "feeAmount"
  | "promoEndDate"
>;

export interface CardBalanceSplit {
  /** What is left on each active transfer, by balanceTransferId. A magnitude. */
  owed: ReadonlyMap<number, number>;
  /**
   * The card's debt that is on no active transfer: purchases, interest, an
   * older balance, and the leftover of any promo that has already ended.
   */
  nonPromo: number;
}

/**
 * The order payments reach a card's transfers once its non-promo debt is
 * cleared: soonest end date first, ties by id. It is also the order the
 * tracker lists a card's rows in.
 */
export const byPayoffOrder = (
  a: Pick<ActiveTransferRow, "promoEndDate" | "balanceTransferId">,
  b: Pick<ActiveTransferRow, "promoEndDate" | "balanceTransferId">
): number =>
  a.promoEndDate.localeCompare(b.promoEndDate) ||
  a.balanceTransferId - b.balanceTransferId;

const toCents = (dollars: number): number => Math.round(dollars * 100);

/** What is owed on a card, in cents: zero when the card is in credit. */
const debtCents = (balance: number): number => Math.max(0, -toCents(balance));

/**
 * Splits a card's debt between its active balance transfers and everything
 * else (Issue #427), by replaying its daily balance history:
 *
 * - A transfer's balance starts at its posting amount, on the posting date.
 *   Its linked fee joins it on the fee's own date (or the posting's, if the
 *   fee is dated earlier), because issuers add the fee to the transfer's
 *   balance. A fee that did not add debt joins nothing.
 * - Debt beyond the transfers' balances is non-promo debt.
 * - When the card's debt falls below the transfers' total, the difference
 *   comes off the transfers in payoff order (byPayoffOrder).
 *
 * Clamping is all the replay does, and it is enough. A rise in debt never
 * touches a transfer, so new charges land in non-promo debt. A fall comes off
 * non-promo debt first, since a transfer is only cut once the transfers
 * together exceed the debt, and only then off the soonest-ending transfer.
 * That is the CARD Act's highest-APR-first rule for payments above the
 * minimum, followed by the promo order that leaves the least to revert.
 *
 * Why a replay rather than a split of today's balance: a card with an older,
 * longer promo that has been partly paid down, and then takes a new, shorter
 * one. On the new posting's day the debt rises by its full amount, so no
 * clamp fires and it keeps its whole balance. Splitting today's balance alone
 * would read it as paid off.
 *
 * Only active transfers are passed in. A promo that ended before `asOf` ends
 * before every active one, so it would sit ahead of all of them in payoff
 * order anyway. Counting its leftover as non-promo debt therefore changes no
 * active transfer's balance, which is why the history can start at the
 * earliest *active* posting.
 *
 * `history` is the card's balance rows, ascending, from that posting through
 * `asOf`. A missing day only delays an event to the next row. A final clamp
 * against `asOfBalance` means a gap at the end can't leave a transfer above
 * the card's debt. The arithmetic is in whole cents, so float noise can't
 * leave a transfer a cent short of paid off.
 */
export function splitCardBalance(
  transfers: readonly SplitTransfer[],
  history: readonly BalancePoint[],
  asOf: string,
  asOfBalance: number
): CardBalanceSplit {
  const order = [...transfers].sort(byPayoffOrder);
  const owed = new Map<number, number>(order.map((t) => [t.balanceTransferId, 0]));

  const events: { date: string; id: number; cents: number }[] = [];
  for (const t of order) {
    if (t.postingAmount < 0) {
      events.push({
        date: t.postingDate,
        id: t.balanceTransferId,
        cents: -toCents(t.postingAmount),
      });
    }
    if (t.feeDate !== null && t.feeAmount !== null && t.feeAmount < 0) {
      events.push({
        date: laterOf(t.feeDate, t.postingDate),
        id: t.balanceTransferId,
        cents: -toCents(t.feeAmount),
      });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  let next = 0;
  const applyEventsThrough = (date: string) => {
    for (; next < events.length && events[next].date <= date; next++) {
      const { id, cents } = events[next];
      owed.set(id, (owed.get(id) ?? 0) + cents);
    }
  };
  const total = () => Array.from(owed.values()).reduce((s, c) => s + c, 0);
  const clamp = (debt: number) => {
    let excess = total() - debt;
    for (const t of order) {
      if (excess <= 0) break;
      const current = owed.get(t.balanceTransferId) ?? 0;
      const take = Math.min(current, excess);
      owed.set(t.balanceTransferId, current - take);
      excess -= take;
    }
  };

  for (const point of history) {
    if (point.date > asOf) break;
    applyEventsThrough(point.date);
    clamp(debtCents(point.balance));
  }
  applyEventsThrough(asOf);
  const finalDebt = debtCents(asOfBalance);
  clamp(finalDebt);

  return {
    owed: new Map(Array.from(owed, ([id, cents]) => [id, cents / 100])),
    nonPromo: (finalDebt - total()) / 100,
  };
}

// ── Assembly ───────────────────────────────────────────────────────────

/** Each card's active transfers, in payoff order. */
function groupByCard<T extends ActiveTransferRow>(rows: readonly T[]): T[][] {
  const byCard = new Map<number, T[]>();
  for (const row of rows) {
    const list = byCard.get(row.accountId) ?? [];
    list.push(row);
    byCard.set(row.accountId, list);
  }
  return Array.from(byCard.values()).map((list) =>
    [...list].sort(byPayoffOrder)
  );
}

const promotionalSince = (card: readonly ActiveTransferRow[]): string =>
  card.reduce(
    (earliest, t) => (t.postingDate < earliest ? t.postingDate : earliest),
    card[0].postingDate
  );

/**
 * Where the second query starts reading each card's balance history: its
 * earliest active posting. The split replays from there, and both pace
 * windows start on or after it, so one range read serves both. Nothing is
 * returned when no transfer is active, so the query can be skipped outright.
 */
export function historyStarts(
  rows: readonly ActiveTransferRow[]
): { accountId: number; since: string }[] {
  return groupByCard(rows).map((card) => ({
    accountId: card[0].accountId,
    since: promotionalSince(card),
  }));
}

/**
 * Every active transfer with what is left on it and what is paid ahead of
 * it, from splitCardBalance() over its card's history. Grouped by card, in
 * payoff order. `history` is keyed by account id; a card with none reads as
 * owing what its as-of balance says.
 */
export function splitActiveTransfers(
  rows: readonly ActiveTransferRow[],
  history: ReadonlyMap<number, readonly BalancePoint[]>
): ActiveTransfer[] {
  return groupByCard(rows).flatMap((card) => {
    const { accountId, asOf, balance } = card[0];
    const { owed, nonPromo } = splitCardBalance(
      card,
      history.get(accountId) ?? [],
      asOf,
      balance
    );
    // Cents, so the running total adds up to the card's debt exactly.
    let aheadCents = toCents(nonPromo);
    return card.map((row) => {
      const owedCents = toCents(owed.get(row.balanceTransferId) ?? 0);
      const transfer = { ...row, owed: owedCents / 100, aheadOfIt: aheadCents / 100 };
      aheadCents += owedCents;
      return transfer;
    });
  });
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
 * One transfer's row. Everything that has to be paid by its end date is
 * `cumulative`: what is left on it plus what is paid ahead of it. Needed / mo,
 * the projection and the status are the single-balance functions above,
 * applied to that. Left at expiry is this transfer's part of what the
 * projection leaves, and payments reach it last, so that part comes first.
 *
 * For a card with one transfer and no other debt, `cumulative` is the card's
 * debt, so every figure is what it was when the card was the unit.
 */
function trackerRow(
  t: ActiveTransfer,
  pace: { threeMonth: number | null; range: number | null }
): BalanceTransferTrackerRow {
  const months = monthsRemaining(t.asOf, t.promoEndDate);
  const daysLeft = daysRemaining(t.asOf, t.promoEndDate);
  const apr = t.promoApr;
  const paidOff = t.owed < CENT_EPSILON;
  const cumulative = t.aheadOfIt + t.owed;
  const requiredPerMonth = paidOff ? null : requiredPayment(cumulative, apr, months);
  const threeMonthPace = paidOff ? null : pace.threeMonth;

  return {
    accountId: t.accountId,
    accountName: t.accountName,
    accountTypeId: t.accountTypeId,
    asOf: t.asOf,
    transfer: termsOf(t),
    owed: t.owed,
    aheadOfIt: t.aheadOfIt,
    monthsRemaining: months,
    daysLeft,
    monthlyInterest: apr > 0 && !paidOff ? t.owed * monthlyRate(apr) : null,
    requiredPerMonth,
    threeMonthPace,
    rangePace: paidOff ? null : pace.range,
    projectedAtExpiry:
      threeMonthPace === null
        ? null
        : Math.min(t.owed, projectedDebt(cumulative, apr, months, threeMonthPace)),
    status: trackerStatus({
      owed: t.owed,
      debt: cumulative,
      daysLeft,
      apr,
      requiredPerMonth: requiredPerMonth ?? 0,
      threeMonthPace,
    }),
  };
}

/**
 * One tracker row per active transfer, a card's rows together in payoff
 * order.
 *
 * Pace is the card's: both windows start no earlier than its earliest active
 * posting, and every active transfer's posting and fee are taken out of it.
 * Start balances are read from `history`, which getActiveTransferBalances()
 * reads from that same posting, so it holds every window start. A start date
 * with no balance row makes that pace `null`.
 *
 * Cards are ordered by the soonest end date among their transfers that still
 * have a balance. A card whose transfers are all paid off goes last, since
 * nothing on it is due. Ties go by account id.
 */
export function buildBalanceTransferTracker(
  transfers: readonly ActiveTransfer[],
  history: ReadonlyMap<number, readonly BalancePoint[]>,
  dateFrom: string
): BalanceTransferTrackerRow[] {
  const cards = groupByCard(transfers).map((card) => {
    const { accountId, asOf, balance } = card[0];
    const starts = paceWindowStarts(asOf, dateFrom, promotionalSince(card));
    const linked = linkedPostings(card);
    const balanceOn = new Map(
      (history.get(accountId) ?? []).map((p) => [p.date, p.balance])
    );
    const paceFrom = (start: string) =>
      monthlyPace({
        startBalance: balanceOn.get(start) ?? null,
        endBalance: balance,
        start,
        end: asOf,
        linked,
      });
    const pace = {
      threeMonth: paceFrom(starts.threeMonth),
      range: paceFrom(starts.range),
    };
    return card.map((t) => trackerRow(t, pace));
  });

  const nextDue = (card: BalanceTransferTrackerRow[]) =>
    card.find((row) => row.status.kind !== "paid_off");

  return cards
    .sort((a, b) => {
      const dueA = nextDue(a);
      const dueB = nextDue(b);
      if (!dueA !== !dueB) return dueA ? -1 : 1;
      return (
        (dueA ?? a[0]).transfer.promoEndDate.localeCompare(
          (dueB ?? b[0]).transfer.promoEndDate
        ) || a[0].accountId - b[0].accountId
      );
    })
    .flat();
}
