import { cache } from "react";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@/lib/db";

type Tx = NodePgDatabase<Record<string, unknown>>;

/**
 * The advisory-lock key space for balance rebuilds (Issue #463). The lock is
 * `pg_advisory_xact_lock(REBUILD_LOCK_NAMESPACE, account_id)`: the first key
 * says what is locked, the second which account. Arbitrary, but fixed and used
 * for nothing else in the app.
 */
export const REBUILD_LOCK_NAMESPACE = 463_001;

/**
 * How long a rebuild waits for another transaction's rebuild of the same
 * account before giving up loudly. Generous next to a rebuild, which takes
 * milliseconds. Its only job is to turn a stuck holder (a session idle in
 * transaction) into a reported error rather than a request that hangs forever.
 */
export const REBUILD_LOCK_TIMEOUT = "15s";

/**
 * Raised when the rebuild lock isn't granted within the timeout. The enclosing
 * transaction is aborted, so nothing the caller wrote is kept. `code` is the
 * SQLSTATE Postgres raised (55P03, lock_not_available), carried on the error
 * itself so reportError() records it: its serializer reads `code` off the error
 * and one level of cause, and the driver error sits under drizzle's wrapper.
 */
export class BalanceRebuildLockTimeoutError extends Error {
  readonly code = "55P03";

  constructor(
    readonly accountId: number,
    readonly timeout: string,
    options?: { cause?: unknown }
  ) {
    super(
      `Timed out after ${timeout} waiting to rebuild balance history for account ${accountId}: another transaction held the account's rebuild lock. Nothing was written.`,
      options
    );
    this.name = "BalanceRebuildLockTimeoutError";
  }
}

/** The SQLSTATE of a driver error, directly or under drizzle's DrizzleQueryError. */
function sqlStateOf(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The driver error itself, unwrapped from drizzle's DrizzleQueryError if it has one. */
function driverError(error: unknown): unknown {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause ?? error;
}

/**
 * Serializes balance-history writes for one account, for the rest of the
 * enclosing transaction (Issue #463).
 *
 * Without it, two transactions rebuilding the same account at once each sum
 * from their own snapshot. The second to commit then overwrites the first's
 * totals through ON CONFLICT DO UPDATE with figures that leave the first one's
 * row out. Nothing errors and the balance is silently wrong until something
 * rewrites that account. With it, the second waits, and its rebuild statement,
 * under READ COMMITTED, takes a fresh snapshot that includes the first one's
 * committed rows.
 *
 * The lock is reentrant within a transaction, so taking it again is free. A
 * transaction that touches several accounts must take them in ascending id
 * order, which rebuildAccountBalances() does, so two transactions can never
 * wait on each other. If one ever did, Postgres's deadlock detector aborts one
 * with SQLSTATE 40P01, and that error goes through the caller's reporting like
 * any other.
 *
 * The wait is bounded by `lockTimeout`, applied to this one statement and then
 * restored. lock_timeout covers advisory locks as well as table and row locks.
 */
export async function lockAccountBalance(
  tx: Tx,
  accountId: number,
  options: { lockTimeout?: string } = {}
): Promise<void> {
  const timeout = options.lockTimeout ?? REBUILD_LOCK_TIMEOUT;
  const previous = await tx.execute<{ lock_timeout: string }>(
    sql`SELECT current_setting('lock_timeout') AS lock_timeout`
  );
  await tx.execute(sql`SELECT set_config('lock_timeout', ${timeout}, true)`);
  try {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${REBUILD_LOCK_NAMESPACE}::integer, ${accountId}::integer)`
    );
  } catch (error) {
    if (sqlStateOf(error) === "55P03") {
      throw new BalanceRebuildLockTimeoutError(accountId, timeout, { cause: driverError(error) });
    }
    throw error;
  }
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${previous.rows[0].lock_timeout}, true)`
  );
}

/**
 * Rebuilds several accounts' balance history in ascending id order: deduped,
 * with nulls (an absent related account) dropped. The order is what keeps two
 * multi-account transactions from deadlocking on the rebuild locks. Use this
 * wherever a write touches more than one account.
 */
export async function rebuildAccountBalances(
  tx: Tx,
  accountIds: Iterable<number | null | undefined>,
  options: { lockTimeout?: string } = {}
): Promise<void> {
  for (const id of sortedAccountIds(accountIds)) {
    await rebuildAccountBalance(tx, id, options);
  }
}

/** Distinct, non-null, ascending: the order every multi-account rebuild locks in. */
export function sortedAccountIds(accountIds: Iterable<number | null | undefined>): number[] {
  const ids = new Set<number>();
  for (const id of accountIds) if (id !== null && id !== undefined) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

/**
 * Rebuilds account_balance_history rows for a single account.
 *
 * Scoped version of scripts/update-account-balance-history.sql.
 * Generates a date series from the account's earliest transaction
 * through today, aggregates daily balances, computes cumulative
 * totals, and upserts into account_balance_history.
 *
 * Designed to run inside an existing Drizzle transaction. Takes the account's
 * rebuild lock first (lockAccountBalance), so concurrent rebuilds of one
 * account serialize rather than overwrite each other.
 */
export async function rebuildAccountBalance(
  tx: Tx,
  accountId: number,
  options: { lockTimeout?: string } = {}
): Promise<void> {
  await lockAccountBalance(tx, accountId, options);
  await tx.execute(sql`
    WITH date_series AS (
      SELECT generate_series(
        (SELECT MIN(DATE(transaction_date)) FROM transactions WHERE account_id = ${accountId}),
        CURRENT_DATE,
        INTERVAL '1 day'
      )::DATE AS balance_date
    ),
    account_dates AS (
      SELECT a.account_id, d.balance_date
      FROM accounts a
      CROSS JOIN date_series d
      WHERE a.account_id = ${accountId}
        AND (a.opened_date IS NULL OR a.opened_date <= d.balance_date)
        AND (a.closed_date IS NULL OR a.closed_date > d.balance_date)
    ),
    daily_transactions AS (
      SELECT
        account_id,
        DATE(transaction_date) AS balance_date,
        SUM(amount) AS daily_balance
      FROM transactions
      WHERE account_id = ${accountId}
      GROUP BY account_id, DATE(transaction_date)
    ),
    daily_with_zeros AS (
      SELECT
        ad.account_id,
        ad.balance_date,
        COALESCE(dt.daily_balance, 0) AS daily_balance
      FROM account_dates ad
      LEFT JOIN daily_transactions dt
        ON ad.account_id = dt.account_id
       AND ad.balance_date = dt.balance_date
    ),
    final_balances AS (
      SELECT
        account_id,
        balance_date,
        daily_balance,
        SUM(daily_balance) OVER (
          PARTITION BY account_id
          ORDER BY balance_date
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_balance
      FROM daily_with_zeros
    )
    INSERT INTO account_balance_history (account_id, balance_date, daily_balance, cumulative_balance)
    SELECT account_id, balance_date, daily_balance, cumulative_balance
    FROM final_balances
    ON CONFLICT (account_id, balance_date)
    DO UPDATE
    SET daily_balance = EXCLUDED.daily_balance,
        cumulative_balance = EXCLUDED.cumulative_balance
  `);
}

/**
 * Ensures every open account has an account_balance_history row for today.
 *
 * If a row doesn't already exist, carries forward the most recent
 * cumulative_balance with daily_balance = 0.  Idempotent via
 * ON CONFLICT DO NOTHING — existing rows (e.g. from rebuildAccountBalance)
 * are never overwritten.
 *
 * Every dashboard page that reads `balance_date = CURRENT_DATE` must await
 * this itself, before its queries, rather than rely on the dashboard layout's
 * call (Issue #408). Two reasons, either of which is enough:
 *
 *   - Next renders a layout and its page in parallel, so the page's SELECTs
 *     can take their snapshot before the layout's INSERT commits. On the first
 *     load of a day that reads no rows for today and shows $0.
 *   - A soft navigation between dashboard tabs re-renders only the page
 *     segment. The shared layout is not rendered at all, so a tab left open
 *     across midnight would never carry balances forward.
 *
 * React's `cache` is what makes calling it from both the layout and the page
 * free: within one server request they share a single execution. Outside a
 * React server render (the integration tests) `cache` is a pass-through, so
 * every call there still runs the INSERT.
 *
 * In steady state the INSERT writes nothing: each account's gap series starts
 * after today, so it is empty, and the statement is one index probe per open
 * account (~0.3 ms). That is why there is no in-process "already done today"
 * memo here (Issue #126): it would save well under a millisecond, and an
 * account opened later in the day with no transactions would then get no row
 * for today until tomorrow.
 */
export const ensureTodayBalances = cache(async (): Promise<void> => {
  await db.execute(sql`
    INSERT INTO account_balance_history
      (account_id, balance_date, daily_balance, cumulative_balance)
    SELECT
      a.account_id,
      d.gap_date,
      0,
      COALESCE(abh.cumulative_balance, 0)
    FROM accounts a
    CROSS JOIN LATERAL (
      SELECT generate_series(
        COALESCE(
          (SELECT MAX(balance_date) + INTERVAL '1 day'
           FROM account_balance_history
           WHERE account_id = a.account_id),
          CURRENT_DATE
        )::date,
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS gap_date
    ) d
    LEFT JOIN LATERAL (
      SELECT cumulative_balance
      FROM account_balance_history
      WHERE account_id = a.account_id
      ORDER BY balance_date DESC
      LIMIT 1
    ) abh ON true
    WHERE a.closed_date IS NULL
    ON CONFLICT (account_id, balance_date) DO NOTHING
  `);
});
