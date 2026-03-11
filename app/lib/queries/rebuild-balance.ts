import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Rebuilds account_balance_history rows for a single account.
 *
 * Scoped version of scripts/UpdateAccountBalanceHistory.sql.
 * Generates a date series from the account's earliest transaction
 * through today, aggregates daily balances, computes cumulative
 * totals, and upserts into account_balance_history.
 *
 * Designed to run inside an existing Drizzle transaction.
 */
export async function rebuildAccountBalance(
  tx: NodePgDatabase<any>,
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
