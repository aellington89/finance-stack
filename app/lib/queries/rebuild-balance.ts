import { cache } from "react";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@/lib/db";

/**
 * Rebuilds account_balance_history rows for a single account.
 *
 * Scoped version of scripts/update-account-balance-history.sql.
 * Generates a date series from the account's earliest transaction
 * through today, aggregates daily balances, computes cumulative
 * totals, and upserts into account_balance_history.
 *
 * Designed to run inside an existing Drizzle transaction.
 */
export async function rebuildAccountBalance(
  tx: NodePgDatabase<Record<string, unknown>>,
  accountId: number
): Promise<void> {
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
