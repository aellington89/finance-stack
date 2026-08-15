-- ==============================================
-- Finances_Test mock data — runs against Finances_Test only.
--
-- Seeds account_types, transaction_categories, accounts, and transactions
-- with deterministic mock data covering the past 12 months relative to
-- CURRENT_DATE at the moment this script runs. After this file executes,
-- rebuild-balance-history.sql must run to populate account_balance_history.
--
-- Sign convention on transactions: negative = outflow, positive = inflow.
--
-- Idempotent: uses ON CONFLICT DO NOTHING so re-running leaves existing
-- rows intact. For a full refresh, DROP and recreate Finances_Test, then
-- run schema.sql + the three seed files in order.
-- ==============================================

-- --------------------------------------------
-- 1. account_types (19 rows)
--    liquidity_class is per-type default; liabilities intentionally NULL.
-- --------------------------------------------
INSERT INTO account_types (account_type_id, account_type, account_type_category_id, liquidity_class)
OVERRIDING SYSTEM VALUE VALUES
    (1,  'Cash & Cash Equivalent',      1, 'liquid'),
    (2,  'Checking Account',            1, 'liquid'),
    (3,  'Savings Account',             1, 'liquid'),
    (4,  'Accounts Receivable',         1, 'liquid'),
    (5,  'Short-term Investment',       1, 'semi_liquid'),
    (6,  'Escrow Account',              2, 'restricted'),
    (7,  'Security Deposit',            2, 'restricted'),
    (8,  'Earmarked',                   2, 'restricted'),
    (9,  'Certificate of Deposit',      4, 'semi_liquid'),
    (10, 'Real Estate',                 3, 'illiquid'),
    (11, 'Vehicle',                     3, 'illiquid'),
    (12, 'Stock, Bond, or Mutual Fund', 4, 'semi_liquid'),
    (13, 'Retirement Account',          4, 'illiquid'),
    (14, 'Cryptocurrency',              4, 'semi_liquid'),
    (15, 'Credit Card',                 5, NULL),
    (16, 'Short-term Loan',             6, NULL),
    (17, 'Mortgage',                    6, NULL),
    (18, 'Student Loan',                6, NULL),
    (19, 'Auto Loan',                   6, NULL)
ON CONFLICT (account_type_id) DO NOTHING;

-- --------------------------------------------
-- 2. transaction_categories
--
-- Fixture rows for Finances_Test only. These are NOT a production seed —
-- transaction_categories is user-managed, and the sole row that ships with the
-- app is id 6 'Other' in shared-lookups.sql (see the seed-data taxonomy in
-- docs/database.md). The IDs here mirror one real Finances database so the
-- Liabilities drilldown has something recognisable to aggregate.
--
-- Every ID pinned by app/lib/queries/liability-categories.ts must appear below
-- with a matching name, and `npm run check:seed-references` now enforces that.
-- It did not until issue #178, and this block was missing four of them — 7, 8,
-- 75 and 76 — so the debt-service totals those tests asserted were quietly
-- computed over a short set. Integration tests still passed because
-- app/tests/integration/vitest-setup.ts upserts a superset at beforeAll, which
-- is exactly the kind of papering-over the gate now prevents.
-- --------------------------------------------
INSERT INTO transaction_categories (transaction_category_id, transaction_category)
OVERRIDING SYSTEM VALUE VALUES
    (1,  'Credit Card Payment'),
    (2,  'HELOC Payment'),
    (3,  'Mortgage Payment'),
    (4,  'Student Loan Payment'),
    (5,  'Cash / Crypto Deposit'),
    (6,  'Other'),
    (7,  'HELOC Principle'),
    (8,  'HELOC Interest'),
    (9,  'Accrued HELOC Interest'),
    (10, 'Cash / Crypto Withdrawal'),
    (12, 'Mortgage Principle'),
    (13, 'Mortgage Interest'),
    (14, 'Accrued Mortgage Interest'),
    (15, 'Labor Earnings'),
    (21, 'Withdrawal to Savings'),
    (22, 'Medicare Tax'),
    (23, 'Federal Income Tax'),
    (24, 'Food / Grocery'),
    (25, 'Social Security Tax'),
    (26, 'State Income Tax'),
    (29, 'Applied Credit'),
    (33, 'Restaurant'),
    (34, 'Entertainment'),
    (36, 'Subscription'),
    (40, 'Fuel'),
    (46, 'Misc'),
    (47, 'Automobile Expense'),
    (51, 'Interest Earned'),
    (54, 'Car Loan Payment'),
    (55, 'Water Utility'),
    (57, 'Epic Loan Interest'),
    (58, 'Epic Loan Payment'),
    (60, 'Gas & Electric Utility'),
    (62, 'Car & Personal Articles Insurance'),
    (63, 'Internet Service Provider'),
    (64, 'Mobile Service Provider'),
    (68, 'Auto Loan Interest'),
    (69, 'Accrued Auto Loan Interest'),
    (70, 'Auto Loan Principle'),
    (74, 'Accrued Student Loan Interest'),
    (75, 'Student Loan Principle'),
    (76, 'Student Loan Interest'),
    (79, 'Balance Transfer Payment Expense'),
    (80, 'Credit Card Interest')
ON CONFLICT (transaction_category_id) DO NOTHING;

-- --------------------------------------------
-- 2b. transaction_categories.reporting_role (issue #111)
--
-- What the Liabilities drilldown reads. Until #111 these categories were named
-- by literal id in app/lib/queries/liability-categories.ts; the role carries
-- that meaning now, and the queries resolve membership against this column at
-- query time so a category the user adds and tags is counted without a code
-- change.
--
-- These are separate UPDATE statements rather than a third column in the INSERT
-- above, and that is load-bearing rather than stylistic: parseSeedRows in
-- app/scripts/seed-reference-check.ts reads `(id, 'name')` tuples and nothing
-- else, so a third column would make every row in that block stop matching, the
-- block parse to zero rows, and three of the gates in that file pass over an
-- empty set while reporting success. `npm run check:seed-references` now fails
-- on an unreadable block rather than trusting this comment to be read.
--
-- The same gate asserts every role in the registry is assigned by at least one
-- row below. A role no fixture category carries is a role whose aggregate the
-- integration suite cannot tell apart from zero — which is exactly how ids 7,
-- 8, 75 and 76 stayed missing from this file for four releases.
--
-- Guarded on IS NULL so a re-run is a no-op.
-- --------------------------------------------
UPDATE transaction_categories SET reporting_role = 'debt_principle_paid'
    WHERE reporting_role IS NULL AND transaction_category_id IN (7, 12, 70, 75);

UPDATE transaction_categories SET reporting_role = 'debt_interest_paid'
    WHERE reporting_role IS NULL AND transaction_category_id IN (8, 13, 57, 68, 76);

-- Credit cards do not split into accrued and paid the way installment loans do
-- — the finance charge is the accrual — so id 80 belongs here, not above.
UPDATE transaction_categories SET reporting_role = 'debt_interest_accrued'
    WHERE reporting_role IS NULL AND transaction_category_id IN (9, 14, 69, 74, 80);

UPDATE transaction_categories SET reporting_role = 'debt_cash_paydown'
    WHERE reporting_role IS NULL AND transaction_category_id IN (29);

-- --------------------------------------------
-- 3. accounts (8 rows — all opened 18 months ago so the 12-month
--    transaction window falls cleanly inside each account's lifetime)
-- --------------------------------------------
INSERT INTO accounts (account_id, account_name, account_type_id, account_identifier, closed_date, opened_date) VALUES
    (1, 'Test Checking - Primary',   2,  '9012345601',       NULL, (CURRENT_DATE - INTERVAL '18 months')::date),
    (2, 'Test Savings - Emergency',  3,  '9012345602',       NULL, (CURRENT_DATE - INTERVAL '18 months')::date),
    (3, 'Test Credit Card - Visa',  15,  '4111222233334444', NULL, (CURRENT_DATE - INTERVAL '18 months')::date),
    (4, 'Test Mortgage - Home',     17,  '7890123456',       NULL, (CURRENT_DATE - INTERVAL '18 months')::date),
    (5, 'Test Auto Loan - Toyota',  19,  '5678901234',       NULL, (CURRENT_DATE - INTERVAL '18 months')::date),
    (6, 'Test Retirement - 401K',   13,  'R-1234567',        NULL, (CURRENT_DATE - INTERVAL '18 months')::date),
    (7, 'Test Savings - Vacation',   3,  '9012345603',       NULL, (CURRENT_DATE - INTERVAL '18 months')::date),
    (8, 'Test Brokerage',           12,  'B-7654321',        NULL, (CURRENT_DATE - INTERVAL '18 months')::date)
ON CONFLICT (account_id) DO NOTHING;

-- --------------------------------------------
-- 4. transactions — all generated relative to CURRENT_DATE.
--
-- Skip this block entirely if transactions already exist, so the script
-- is safe to re-run against a populated Finances_Test.
-- --------------------------------------------
DO $$
DECLARE
    month0 date := (date_trunc('month', CURRENT_DATE) - INTERVAL '11 months')::date; -- first day, 11 months ago
    opening_date date := (CURRENT_DATE - INTERVAL '12 months')::date;
BEGIN
    IF (SELECT count(*) FROM transactions) > 0 THEN
        RAISE NOTICE 'Finances_Test transactions already present — skipping mock data insert.';
        RETURN;
    END IF;

    -- ---- Opening balances (one per account, dated 12 months ago) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id) VALUES
        ('Opening Balance',              opening_date, 1,   8500.00, NULL, 12, 6),
        ('Opening Balance',              opening_date, 2,  12000.00, NULL, 12, 6),
        ('Opening Balance',              opening_date, 3,  -1250.00, NULL, 12, 6),
        ('Opening Balance',              opening_date, 4, -245000.00, NULL, 12, 6),
        ('Opening Balance',              opening_date, 5,  -18500.00, NULL, 12, 6),
        ('Opening Balance',              opening_date, 6,  42000.00, NULL, 12, 6),
        ('Opening Balance',              opening_date, 7,   3200.00, NULL, 12, 6),
        ('Opening Balance',              opening_date, 8,  25000.00, NULL, 12, 6);

    -- ---- Biweekly paychecks into checking (26 over 12 months) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT
        'Salary Deposit',
        (opening_date + INTERVAL '1 day' + (n * INTERVAL '14 days'))::date,
        1, 3500.00, NULL, 4, 15
    FROM generate_series(0, 25) n
    WHERE (opening_date + INTERVAL '1 day' + (n * INTERVAL '14 days'))::date <= CURRENT_DATE;

    -- ---- Biweekly 401k contributions (26 over 12 months) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT
        '401K Contribution',
        (opening_date + INTERVAL '1 day' + (n * INTERVAL '14 days'))::date,
        6, 600.00, NULL, 10, 6
    FROM generate_series(0, 25) n
    WHERE (opening_date + INTERVAL '1 day' + (n * INTERVAL '14 days'))::date <= CURRENT_DATE;

    -- ---- Monthly mortgage payments ----
    -- Cash side: one debit on checking, category 3 (Mortgage Payment).
    -- Liability side: split into principal (cat 12) + interest (cat 13)
    -- so the totals match production conventions where each loan payment
    -- posts to the liability account as two legs.
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Mortgage Payment', (month0 + (n * INTERVAL '1 month') + INTERVAL '9 days')::date,
           1, -2100.00, 4, 1, 3
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '9 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Mortgage Principle', (month0 + (n * INTERVAL '1 month') + INTERVAL '9 days')::date,
           4, 900.00, 1, 1, 12
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '9 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Mortgage Interest', (month0 + (n * INTERVAL '1 month') + INTERVAL '9 days')::date,
           4, 1200.00, 1, 1, 13
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '9 days')::date <= CURRENT_DATE;

    -- ---- Monthly mortgage interest accruals (12) ----
    -- Category 14 (Accrued Mortgage Interest) is one of the IDs the
    -- Liabilities-drilldown debt-service queries pin. Keep this row aligned.
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Mortgage Interest Accrual', (month0 + (n * INTERVAL '1 month') + INTERVAL '14 days')::date,
           4, -1200.00, NULL, 9, 14
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '14 days')::date <= CURRENT_DATE;

    -- ---- Monthly utilities (36 = 3 × 12) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Electric & Gas', (month0 + (n * INTERVAL '1 month') + INTERVAL '17 days')::date,
           1, -135.20, NULL, 2, 60
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '17 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Water Utility', (month0 + (n * INTERVAL '1 month') + INTERVAL '19 days')::date,
           1, -42.50, NULL, 2, 55
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '19 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Internet Service', (month0 + (n * INTERVAL '1 month') + INTERVAL '20 days')::date,
           1, -79.99, NULL, 2, 63
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '20 days')::date <= CURRENT_DATE;

    -- ---- Monthly subscriptions (24 = 2 × 12) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Streaming Subscription', (month0 + (n * INTERVAL '1 month') + INTERVAL '4 days')::date,
           1, -15.99, NULL, 2, 36
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '4 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Mobile Phone', (month0 + (n * INTERVAL '1 month') + INTERVAL '21 days')::date,
           1, -85.00, NULL, 2, 64
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '21 days')::date <= CURRENT_DATE;

    -- ---- Monthly credit card payment (12 pairs = 24 rows) ----
    -- Cash side: cat 1 (Credit Card Payment). Liability side: cat 29
    -- (Applied Credit) — production convention for credit-card paydowns.
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Payment to Visa', (month0 + (n * INTERVAL '1 month') + INTERVAL '5 days')::date,
           1, -450.00, 3, 1, 1
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '5 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Payment from Checking', (month0 + (n * INTERVAL '1 month') + INTERVAL '5 days')::date,
           3, 450.00, 1, 1, 29
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '5 days')::date <= CURRENT_DATE;

    -- ---- Monthly auto loan payment ----
    -- Cash side: cat 54 (Car Loan Payment). Liability side splits into
    -- principal (cat 70) + interest (cat 68).
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Auto Loan Payment', (month0 + (n * INTERVAL '1 month') + INTERVAL '7 days')::date,
           1, -385.00, 5, 1, 54
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '7 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Auto Loan Principle', (month0 + (n * INTERVAL '1 month') + INTERVAL '7 days')::date,
           5, 265.00, 1, 1, 70
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '7 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Auto Loan Interest', (month0 + (n * INTERVAL '1 month') + INTERVAL '7 days')::date,
           5, 120.00, 1, 1, 68
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '7 days')::date <= CURRENT_DATE;

    -- ---- Monthly auto loan interest accrual (12) ----
    -- Category 69 (Accrued Auto Loan Interest) is one of the IDs the
    -- Liabilities-drilldown debt-service queries pin. Keep this row aligned.
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Auto Loan Interest Accrual', (month0 + (n * INTERVAL '1 month') + INTERVAL '14 days')::date,
           5, -120.00, NULL, 9, 69
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '14 days')::date <= CURRENT_DATE;

    -- ---- Monthly transfer to emergency savings (12 pairs = 24 rows) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Transfer to Savings', (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date,
           1, -500.00, 2, 1, 21
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Transfer from Checking', (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date,
           2, 500.00, 1, 1, 5
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date <= CURRENT_DATE;

    -- ---- Monthly transfer to vacation savings (12 pairs = 24 rows) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Transfer to Vacation Savings', (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date,
           1, -200.00, 7, 1, 21
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Transfer from Checking', (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date,
           7, 200.00, 1, 1, 5
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '15 days')::date <= CURRENT_DATE;

    -- ---- Monthly savings interest (12) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Interest Earned', (month0 + (n * INTERVAL '1 month') + INTERVAL '27 days')::date,
           2, 4.50, NULL, 4, 51
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '27 days')::date <= CURRENT_DATE;

    -- ---- Credit card spending: 10/month × 12 = 120 rows ----
    -- Day/category/amount rotate through a fixed pattern so the result is deterministic.
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT
        spend.description,
        (month0 + (months.n * INTERVAL '1 month') + (spend.day_offset * INTERVAL '1 day'))::date,
        3, spend.amount, NULL, 2, spend.category_id
    FROM generate_series(0, 11) AS months(n)
    CROSS JOIN (VALUES
        (2,  'Grocery Store',       -85.40,  24),
        (4,  'Coffee Shop',         -12.75,  33),
        (7,  'Gas Station',         -48.20,  40),
        (10, 'Restaurant',          -55.00,  33),
        (12, 'Pharmacy',            -24.30,  46),
        (15, 'Online Shopping',     -92.99,  46),
        (18, 'Movie Theater',       -28.50,  34),
        (22, 'Grocery Store',      -118.65,  24),
        (25, 'Gas Station',         -52.40,  40),
        (28, 'Restaurant',          -72.80,  33)
    ) AS spend(day_offset, description, amount, category_id)
    WHERE (month0 + (months.n * INTERVAL '1 month') + (spend.day_offset * INTERVAL '1 day'))::date <= CURRENT_DATE;

    -- ---- Checking grocery debit (12) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Grocery Store Debit', (month0 + (n * INTERVAL '1 month') + INTERVAL '3 days')::date,
           1, -120.00, NULL, 2, 24
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '3 days')::date <= CURRENT_DATE;

    -- ---- Checking restaurant debit (12) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Restaurant Debit', (month0 + (n * INTERVAL '1 month') + INTERVAL '11 days')::date,
           1, -55.00, NULL, 2, 33
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '11 days')::date <= CURRENT_DATE;

    -- ---- Monthly brokerage investment (12 pairs = 24 rows) ----
    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Brokerage Contribution', (month0 + (n * INTERVAL '1 month') + INTERVAL '20 days')::date,
           1, -500.00, 8, 10, 6
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '20 days')::date <= CURRENT_DATE;

    INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id)
    SELECT 'Brokerage Contribution', (month0 + (n * INTERVAL '1 month') + INTERVAL '20 days')::date,
           8, 500.00, 1, 10, 6
    FROM generate_series(0, 11) n
    WHERE (month0 + (n * INTERVAL '1 month') + INTERVAL '20 days')::date <= CURRENT_DATE;
END $$;

-- --------------------------------------------
-- 5. Advance IDENTITY sequences past the highest explicit IDs.
-- --------------------------------------------
SELECT setval(
    pg_get_serial_sequence('account_type_categories', 'account_type_category_id'),
    GREATEST((SELECT MAX(account_type_category_id) FROM account_type_categories), 1)
);
SELECT setval(
    pg_get_serial_sequence('account_types', 'account_type_id'),
    GREATEST((SELECT MAX(account_type_id) FROM account_types), 1)
);
SELECT setval(
    pg_get_serial_sequence('transaction_types', 'transaction_type_id'),
    GREATEST((SELECT MAX(transaction_type_id) FROM transaction_types), 1)
);
SELECT setval(
    pg_get_serial_sequence('transaction_categories', 'transaction_category_id'),
    GREATEST((SELECT MAX(transaction_category_id) FROM transaction_categories), 1)
);

-- accounts and transactions use nextval()-driven SERIAL sequences,
-- so explicit IDs do not auto-advance them. Bump them manually.
SELECT setval('accounts_account_id_seq',
    GREATEST((SELECT MAX(account_id) FROM accounts), 1));
SELECT setval('transactions_transaction_id_seq',
    GREATEST((SELECT MAX(transaction_id) FROM transactions), 1));
