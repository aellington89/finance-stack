import { cache } from "react";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { LIABILITY_CATEGORY_IDS } from "@/lib/queries/liability-categories";
import {
  EXTERNAL_TRANSFER_TYPE,
  INTERNAL_TRANSFER_TYPE,
} from "@/lib/constants/reference-ids";
import {
  balanceRowPerAccount,
  promoActiveOn,
  valueList,
} from "@/lib/queries/_aggregates";
import {
  buildBalanceTransferTracker,
  historyStarts,
  splitActiveTransfers,
  type ActiveTransfer,
  type ActiveTransferRow,
  type BalancePoint,
  type BalanceTransferTrackerRow,
} from "@/lib/queries/balance-transfer-payoff";

// Balance transfers (Issue #417). A balance_transfers row holds only the
// offer's end date and APR. Everything else is read from the posting it links,
// here at query time, so editing the posting edits the transfer.
//
// Two rules every read below shares:
//   - The card is the posting's account *now*, and it must still be a
//     liability. A posting moved to an asset account drops out rather than
//     being reported as a transfer.
//   - A fee only counts while it is on the same card as its posting. One moved
//     elsewhere reads as unlinked rather than showing a figure that isn't on
//     this card.

const LIABILITY_IDS = valueList(LIABILITY_CATEGORY_IDS);
const TRANSFER_TYPE_IDS = valueList([
  INTERNAL_TRANSFER_TYPE.id,
  EXTERNAL_TRANSFER_TYPE.id,
]);

const num = (v: string | null): number | null =>
  v === null ? null : parseFloat(v);

// ── Active transfers, and what is left on each ─────────────────────────

/** Every transfer active on the as-of date, and the history behind the split. */
export interface ActiveTransferSnapshot {
  /** Grouped by card, in payoff order, each with what is left on it. */
  transfers: ActiveTransfer[];
  /**
   * Each card's balance history from its earliest active posting through the
   * as-of date, ascending, keyed by account id.
   */
  history: ReadonlyMap<number, BalancePoint[]>;
}

/**
 * Every liability card's transfers active on `dateTo` (or today), split by
 * splitCardBalance() into what is left on each and the card's non-promo debt
 * (Issue #427). `accountId` narrows it to one card, for the account edit page.
 *
 * Two queries, not one. Which history to read depends on the transfers found:
 * each card's is read from its earliest active posting, where the split's
 * replay starts. Both pace windows start on or after that date too, so the
 * same rows give the tracker its start balances. The second query is one
 * index range scan per card, at most a row a day for the longest promo, and it
 * is skipped outright when nothing is active, which is the common case.
 */
async function loadActiveTransfers(
  dateTo?: string,
  accountId?: number
): Promise<ActiveTransferSnapshot> {
  const asOfExpr = dateTo ? sql`${dateTo}::date` : sql`CURRENT_DATE`;
  const oneCard = accountId === undefined ? sql`` : sql`AND p.account_id = ${accountId}`;

  const result = await db.execute(sql`
    SELECT
      bt.balance_transfer_id,
      a.account_id,
      a.account_name,
      a.account_type_id,
      p.transaction_id AS posting_transaction_id,
      p.transaction_date AS posting_date,
      p.amount AS posting_amount,
      src.account_name AS source_account_name,
      bt.promo_end_date,
      bt.promo_apr,
      fee.transaction_id AS fee_transaction_id,
      fee.amount AS fee_amount,
      fee.transaction_date AS fee_date,
      abh.cumulative_balance AS balance,
      ${asOfExpr} AS as_of
    FROM balance_transfers bt
    JOIN transactions p ON p.transaction_id = bt.transfer_transaction_id
    JOIN accounts a ON a.account_id = p.account_id
    JOIN account_types at ON at.account_type_id = a.account_type_id
    ${balanceRowPerAccount(dateTo)}
    LEFT JOIN accounts src ON src.account_id = p.related_account_id
    LEFT JOIN transactions fee
      ON fee.transaction_id = bt.fee_transaction_id
     AND fee.account_id = p.account_id
    WHERE at.account_type_category_id IN (${LIABILITY_IDS})
      AND (a.closed_date IS NULL OR a.closed_date > ${asOfExpr})
      AND ${promoActiveOn(asOfExpr)}
      ${oneCard}
    ORDER BY bt.promo_end_date, bt.balance_transfer_id
  `);

  type Row = {
    balance_transfer_id: number;
    account_id: number;
    account_name: string;
    account_type_id: number;
    posting_transaction_id: number;
    posting_date: string;
    posting_amount: string;
    source_account_name: string | null;
    promo_end_date: string;
    promo_apr: string;
    fee_transaction_id: number | null;
    fee_amount: string | null;
    fee_date: string | null;
    balance: string;
    as_of: string;
  };

  const rows: ActiveTransferRow[] = (result.rows as Row[]).map((r) => ({
    balanceTransferId: r.balance_transfer_id,
    accountId: r.account_id,
    accountName: r.account_name,
    accountTypeId: r.account_type_id,
    postingTransactionId: r.posting_transaction_id,
    postingDate: r.posting_date,
    postingAmount: parseFloat(r.posting_amount),
    sourceAccountName: r.source_account_name,
    promoEndDate: r.promo_end_date,
    promoApr: parseFloat(r.promo_apr),
    feeTransactionId: r.fee_transaction_id,
    feeAmount: num(r.fee_amount),
    feeDate: r.fee_date,
    balance: parseFloat(r.balance) || 0,
    asOf: r.as_of,
  }));

  const starts = historyStarts(rows);
  const history = new Map<number, BalancePoint[]>();

  if (starts.length > 0) {
    const cards = sql.join(
      starts.map((s) => sql`(${s.accountId}::integer, ${s.since}::date)`),
      sql`, `
    );
    const balances = await db.execute(sql`
      SELECT h.account_id, h.balance_date, h.cumulative_balance
      FROM account_balance_history h
      JOIN (VALUES ${cards}) AS card(account_id, since)
        ON h.account_id = card.account_id
       AND h.balance_date BETWEEN card.since AND ${asOfExpr}
      ORDER BY h.account_id, h.balance_date
    `);
    for (const b of balances.rows as {
      account_id: number;
      balance_date: string;
      cumulative_balance: string;
    }[]) {
      const points = history.get(b.account_id) ?? [];
      points.push({
        date: b.balance_date,
        balance: parseFloat(b.cumulative_balance) || 0,
      });
      history.set(b.account_id, points);
    }
  }

  return { transfers: splitActiveTransfers(rows, history), history };
}

/**
 * loadActiveTransfers() for every card, once per request. The drilldown asks
 * three things of it, the tracker, the debt-mix split and the badge, and
 * React's `cache` makes them share one execution, as ensureTodayBalances()
 * does for the layout and the page. So the three can't disagree within a
 * page. Outside a React server render (the integration tests) `cache` is a
 * pass-through, and every call queries afresh.
 *
 * `cache` keys on the arguments as passed, so callers pass `dateTo` even when
 * it is undefined: `f()` and `f(undefined)` would be two entries.
 */
export const getActiveTransferBalances = cache(
  (dateTo: string | undefined): Promise<ActiveTransferSnapshot> =>
    loadActiveTransfers(dateTo)
);

// ── The drilldown's Balance transfers card ─────────────────────────────

/**
 * One tracker row per balance transfer active on the range's end date
 * (`dateTo`, or today), the as-of date the allocation tiles use. A card's rows
 * are together, in payoff order. The math lives in balance-transfer-payoff.ts.
 */
export async function getActiveBalanceTransfers(
  dateFrom: string,
  dateTo?: string
): Promise<BalanceTransferTrackerRow[]> {
  const { transfers, history } = await getActiveTransferBalances(dateTo);
  return buildBalanceTransferTracker(transfers, history, dateFrom);
}

// ── The account edit page's Balance transfers section ──────────────────

export interface AccountBalanceTransfer {
  balanceTransferId: number;
  transferTransactionId: number;
  postingDate: string;
  postingDescription: string;
  /** Ledger sign: negative for a posting that added debt. */
  postingAmount: number;
  sourceAccountName: string | null;
  feeTransactionId: number | null;
  feeDate: string | null;
  feeDescription: string | null;
  feeAmount: number | null;
  promoEndDate: string;
  promoApr: number;
  /** Active today, by the same rule the drilldown uses. */
  isActive: boolean;
  /**
   * What is left on an active transfer today, from the same balance split the
   * drilldown uses (Issue #427): 0 when it is paid off. `null` for an ended
   * transfer, and for one the split doesn't cover (a closed card).
   */
  remaining: number | null;
}

/**
 * The account's transfers, active ones first (soonest end first), then the
 * rest, most recently ended first.
 *
 * "Today" for `remaining` is the card's latest balance row, the one
 * balanceRowPerAccount() picks without a date. This page is outside the
 * dashboard and doesn't carry balances forward, but a carried-forward row
 * only repeats the latest balance, so the figure is the drilldown's with no
 * end date either way.
 */
export async function getBalanceTransfersForAccount(
  accountId: number
): Promise<AccountBalanceTransfer[]> {
  const [result, { transfers: active }] = await Promise.all([
    db.execute(sql`
    SELECT
      bt.balance_transfer_id,
      p.transaction_id AS transfer_transaction_id,
      p.transaction_date AS posting_date,
      p.transaction_description AS posting_description,
      p.amount AS posting_amount,
      src.account_name AS source_account_name,
      fee.transaction_id AS fee_transaction_id,
      fee.transaction_date AS fee_date,
      fee.transaction_description AS fee_description,
      fee.amount AS fee_amount,
      bt.promo_end_date,
      bt.promo_apr,
      ${promoActiveOn(sql`CURRENT_DATE`)} AS is_active
    FROM balance_transfers bt
    JOIN transactions p ON p.transaction_id = bt.transfer_transaction_id
    LEFT JOIN accounts src ON src.account_id = p.related_account_id
    LEFT JOIN transactions fee
      ON fee.transaction_id = bt.fee_transaction_id
     AND fee.account_id = p.account_id
    WHERE p.account_id = ${accountId}
  `),
    loadActiveTransfers(undefined, accountId),
  ]);
  const owed = new Map(active.map((t) => [t.balanceTransferId, t.owed]));

  type Row = {
    balance_transfer_id: number;
    transfer_transaction_id: number;
    posting_date: string;
    posting_description: string;
    posting_amount: string;
    source_account_name: string | null;
    fee_transaction_id: number | null;
    fee_date: string | null;
    fee_description: string | null;
    fee_amount: string | null;
    promo_end_date: string;
    promo_apr: string;
    is_active: boolean;
  };

  return (result.rows as Row[])
    .map((r) => ({
      balanceTransferId: r.balance_transfer_id,
      transferTransactionId: r.transfer_transaction_id,
      postingDate: r.posting_date,
      postingDescription: r.posting_description,
      postingAmount: parseFloat(r.posting_amount),
      sourceAccountName: r.source_account_name,
      feeTransactionId: r.fee_transaction_id,
      feeDate: r.fee_date,
      feeDescription: r.fee_description,
      feeAmount: num(r.fee_amount),
      promoEndDate: r.promo_end_date,
      promoApr: parseFloat(r.promo_apr),
      isActive: r.is_active,
      remaining: r.is_active ? (owed.get(r.balance_transfer_id) ?? null) : null,
    }))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const byEnd = a.isActive
        ? a.promoEndDate.localeCompare(b.promoEndDate)
        : b.promoEndDate.localeCompare(a.promoEndDate);
      return byEnd || a.balanceTransferId - b.balanceTransferId;
    });
}

export interface BalanceTransferCandidate {
  transactionId: number;
  transactionDate: string;
  description: string;
  /** Ledger sign. */
  amount: number;
  transactionTypeId: number;
  /** The transfer this row is already linked to, as posting or fee, if any. */
  linkedBalanceTransferId: number | null;
}

/**
 * The transactions the edit dialog's two pickers choose from: the card's
 * postings that added debt. A transfer's posting adds debt by definition, and
 * so does its fee, so one list serves both pickers. Rows already linked on
 * this account are included whatever their sign, so an edit dialog can always
 * show its current selection.
 *
 * Bounded, because every purchase on a card adds debt and a long-lived card
 * has thousands. A row is offered if any of these holds:
 *   - it is a transfer type, of any age, since postings are usually one;
 *   - it is from the last 24 months, which covers any promo still running;
 *   - it falls within 60 days after a transfer-typed posting, so the fee of an
 *     old transfer being backfilled is still reachable;
 *   - it is already linked.
 */
export async function getBalanceTransferCandidates(
  accountId: number
): Promise<BalanceTransferCandidate[]> {
  const result = await db.execute(sql`
    SELECT
      t.transaction_id,
      t.transaction_date,
      t.transaction_description,
      t.amount,
      t.transaction_type_id,
      COALESCE(bp.balance_transfer_id, bf.balance_transfer_id) AS linked_balance_transfer_id
    FROM transactions t
    LEFT JOIN balance_transfers bp ON bp.transfer_transaction_id = t.transaction_id
    LEFT JOIN balance_transfers bf ON bf.fee_transaction_id = t.transaction_id
    WHERE t.account_id = ${accountId}
      AND (
        bp.balance_transfer_id IS NOT NULL
        OR bf.balance_transfer_id IS NOT NULL
        OR (
          t.amount < 0
          AND (
            t.transaction_type_id IN (${TRANSFER_TYPE_IDS})
            OR t.transaction_date >= (CURRENT_DATE - INTERVAL '24 months')::date
            OR EXISTS (
              SELECT 1 FROM transactions x
              WHERE x.account_id = t.account_id
                AND x.amount < 0
                AND x.transaction_type_id IN (${TRANSFER_TYPE_IDS})
                AND t.transaction_date >= x.transaction_date
                AND t.transaction_date <= x.transaction_date + 60
            )
          )
        )
      )
    ORDER BY t.transaction_date DESC, t.transaction_id DESC
  `);

  type Row = {
    transaction_id: number;
    transaction_date: string;
    transaction_description: string;
    amount: string;
    transaction_type_id: number;
    linked_balance_transfer_id: number | null;
  };

  return (result.rows as Row[]).map((r) => ({
    transactionId: r.transaction_id,
    transactionDate: r.transaction_date,
    description: r.transaction_description,
    amount: parseFloat(r.amount),
    transactionTypeId: r.transaction_type_id,
    linkedBalanceTransferId: r.linked_balance_transfer_id,
  }));
}
