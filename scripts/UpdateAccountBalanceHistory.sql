-- ============================================
-- Rebuilds the account_balance_history table
-- with daily cumulative balances for all open accounts
-- through the current date (even if no transactions today)
-- ============================================

WITH date_series AS (
    -- 1️⃣ Generate a complete list of calendar dates
    --    from the earliest transaction date up to today.
    SELECT generate_series(
        (SELECT MIN(DATE(transaction_date)) FROM transactions),
        CURRENT_DATE,
        INTERVAL '1 day'
    )::DATE AS balance_date
),

account_dates AS (
    -- 2️⃣ Create a row for every account × date combination
    --    for all dates the account was open.
    --    This ensures even days without transactions are represented.
    SELECT a.account_id, d.balance_date
    FROM accounts a
    CROSS JOIN date_series d
    WHERE (a.opened_date IS NULL OR a.opened_date <= d.balance_date)
      AND (a.closed_date IS NULL OR a.closed_date > d.balance_date)
),

daily_transactions AS (
    -- 3️⃣ Aggregate transactions by account and date.
    --    Each row represents the net change for that day.
    SELECT
        account_id,
        DATE(transaction_date) AS balance_date,
        SUM(amount) AS daily_balance
    FROM transactions
    GROUP BY account_id, DATE(transaction_date)
),

daily_with_zeros AS (
    -- 4️⃣ Combine the account_dates with daily transactions.
    --    Fill missing transaction days with zero (no change in balance).
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
    -- 5️⃣ Calculate cumulative (running) balance for each account
    --    using a window function that sums all daily balances
    --    from account open to the current date.
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

-- 6️⃣ Insert or update results in the target table.
--    If the (account_id, balance_date) already exists, update balances.
INSERT INTO account_balance_history (account_id, balance_date, daily_balance, cumulative_balance)
SELECT account_id, balance_date, daily_balance, cumulative_balance
FROM final_balances
ON CONFLICT (account_id, balance_date)
DO UPDATE
SET daily_balance = EXCLUDED.daily_balance,
    cumulative_balance = EXCLUDED.cumulative_balance;

