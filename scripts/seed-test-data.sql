-- ==============================================
-- Test seed data for Finances_Test database
--
-- Mirrors the structure of production data with different values.
-- This script is idempotent: it truncates all tables before inserting.
--
-- Usage:
--   docker exec -i postgres psql -U postgres -d Finances_Test < scripts/seed-test-data.sql
--
-- After seeding, rebuild balance history:
--   docker compose --profile init run --rm -e PGDATABASE=Finances_Test init-script
-- ==============================================

-- Clear existing data (in FK-safe order)
TRUNCATE account_balance_history, transactions, accounts, account_types, account_type_categories, transaction_categories, transaction_types CASCADE;

-- Reset sequences
ALTER SEQUENCE accounts_account_id_seq RESTART WITH 1;
ALTER SEQUENCE transactions_transaction_id_seq RESTART WITH 1;
-- Identity columns reset via TRUNCATE + RESTART IDENTITY isn't needed
-- because we use OVERRIDING SYSTEM VALUE with explicit IDs below.

-- =====================
-- Account Type Categories
-- =====================
INSERT INTO account_type_categories (account_type_category_id, account_type_category) OVERRIDING SYSTEM VALUE VALUES
    (1, 'Current Asset'),
    (2, 'Restricted Asset'),
    (3, 'Fixed Asset'),
    (4, 'Investment'),
    (5, 'Current Liability'),
    (6, 'Non-current Liability');

SELECT setval('account_type_categories_account_type_category_id_seq', 6);

-- =====================
-- Account Types (representative subset)
-- =====================
INSERT INTO account_types (account_type_id, account_type, account_type_category_id) OVERRIDING SYSTEM VALUE VALUES
    (1, 'Cash & Cash Equivalent', 1),
    (2, 'Checking Account', 1),
    (3, 'Savings Account', 1),
    (4, 'Accounts Receivable', 1),
    (5, 'Short-term Investment', 1),
    (6, 'Escrow Account', 2),
    (7, 'Security Deposit', 2),
    (8, 'Earmarked', 2),
    (9, 'Certificate of Deposit', 4),
    (10, 'Real Estate', 3),
    (11, 'Vehicle', 3),
    (12, 'Stock, Bond, or Mutual Fund', 4),
    (13, 'Retirement Account', 4),
    (14, 'Cryptocurrency', 4),
    (15, 'Credit Card', 5),
    (16, 'Short-term Loan', 6),
    (17, 'Mortgage', 6),
    (18, 'Student Loan', 6),
    (19, 'Auto Loan', 6);

SELECT setval('account_types_account_type_id_seq', 19);

-- =====================
-- Transaction Types
-- =====================
INSERT INTO transaction_types (transaction_type_id, transaction_type) OVERRIDING SYSTEM VALUE VALUES
    (1, 'Internal Transfer'),
    (2, 'Expense'),
    (3, 'Refund'),
    (4, 'Income'),
    (5, 'Work Expense'),
    (6, 'Work Expense Reimbursement'),
    (7, 'Other'),
    (8, 'External Transfer'),
    (9, 'Accrued Amoritized Interest'),
    (10, 'Investment'),
    (11, 'Asset Re-Evaluation');

SELECT setval('transaction_types_transaction_type_id_seq', 11);

-- =====================
-- Transaction Categories (representative subset)
-- =====================
INSERT INTO transaction_categories (transaction_category_id, transaction_category) OVERRIDING SYSTEM VALUE VALUES
    (1, 'Credit Card Payment'),
    (2, 'HELOC Payment'),
    (3, 'Mortgage Payment'),
    (4, 'Student Loan Payment'),
    (5, 'Cash / Crypto Deposit'),
    (6, 'Other'),
    (10, 'Cash / Crypto Withdrawal'),
    (15, 'Labor Earnings'),
    (21, 'Withdrawal to Savings'),
    (22, 'Medicare Tax'),
    (23, 'Federal Income Tax'),
    (24, 'Food / Grocery'),
    (25, 'Social Security Tax'),
    (26, 'State Income Tax'),
    (33, 'Restaurant'),
    (34, 'Entertainment'),
    (36, 'Subscription'),
    (40, 'Fuel'),
    (46, 'Misc'),
    (47, 'Automobile Expense'),
    (51, 'Interest Earned'),
    (54, 'Car Loan Payment'),
    (55, 'Water Utility'),
    (60, 'Gas & Electric Utility'),
    (62, 'Car & Personal Articles Insurance'),
    (63, 'Internet Service Provider'),
    (64, 'Mobile Service Provider');

SELECT setval('transaction_type_categories_transaction_type_category_id_seq', 82);

-- =====================
-- Accounts
-- =====================
INSERT INTO accounts (account_name, account_type_id, account_identifier, closed_date, opened_date) VALUES
    ('Test Checking - Primary',      2,  '9012345601', NULL, '2024-06-01'),
    ('Test Savings - Emergency',     3,  '9012345601', NULL, '2024-06-15'),
    ('Test Credit Card - Visa',     15,  '4111222233334444', NULL, '2024-06-01'),
    ('Test Mortgage - Home',        17,  '7890123456', NULL, '2024-06-01'),
    ('Test Auto Loan - Toyota',     19,  '5678901234', NULL, '2024-08-01'),
    ('Test Retirement - 401K',      13,  'R-1234567', NULL, '2024-07-01'),
    ('Test Savings - Vacation',      3,  '9012345602', NULL, '2024-07-01');

-- =====================
-- Transactions (spanning Jul - Dec 2024)
-- Sign convention: negative = outflow, positive = inflow
-- =====================
INSERT INTO transactions (transaction_description, transaction_date, account_id, amount, related_account_id, transaction_type_id, transaction_category_id) VALUES

    -- July 2024 - Checking (account_id = 1)
    ('Salary Deposit',                       '2024-07-01',  1,  4200.00, NULL, 4, 15),
    ('Grocery Store',                        '2024-07-03',  1,  -112.45, NULL, 2, 24),
    ('Payment to Visa',                      '2024-07-05',  1,  -325.00,    3, 1,  1),
    ('Mortgage Payment',                     '2024-07-10',  1, -2100.00,    4, 1,  3),
    ('Gas Station',                          '2024-07-12',  1,   -48.75, NULL, 2, 40),
    ('Salary Deposit',                       '2024-07-15',  1,  4200.00, NULL, 4, 15),
    ('Transfer to Savings',                  '2024-07-16',  1,  -500.00,    2, 1, 21),
    ('Electric Bill',                        '2024-07-18',  1,  -135.20, NULL, 2, 60),
    ('Internet Service',                     '2024-07-20',  1,   -79.99, NULL, 2, 63),
    ('Restaurant Dinner',                    '2024-07-22',  1,   -67.50, NULL, 2, 33),

    -- August 2024 - Checking
    ('Salary Deposit',                       '2024-08-01',  1,  4200.00, NULL, 4, 15),
    ('Grocery Store',                        '2024-08-04',  1,   -98.30, NULL, 2, 24),
    ('Payment to Visa',                      '2024-08-05',  1,  -410.00,    3, 1,  1),
    ('Mortgage Payment',                     '2024-08-10',  1, -2100.00,    4, 1,  3),
    ('Car Insurance',                        '2024-08-11',  1,  -165.00, NULL, 2, 62),
    ('Salary Deposit',                       '2024-08-15',  1,  4200.00, NULL, 4, 15),
    ('Transfer to Savings',                  '2024-08-16',  1,  -500.00,    2, 1, 21),
    ('Water Bill',                           '2024-08-20',  1,   -42.18, NULL, 2, 55),
    ('Mobile Phone',                         '2024-08-22',  1,   -85.00, NULL, 2, 64),

    -- September 2024 - Checking
    ('Salary Deposit',                       '2024-09-01',  1,  4200.00, NULL, 4, 15),
    ('Grocery Store',                        '2024-09-05',  1,  -125.60, NULL, 2, 24),
    ('Payment to Visa',                      '2024-09-05',  1,  -275.00,    3, 1,  1),
    ('Mortgage Payment',                     '2024-09-10',  1, -2100.00,    4, 1,  3),
    ('Salary Deposit',                       '2024-09-15',  1,  4200.00, NULL, 4, 15),
    ('Transfer to Savings',                  '2024-09-16',  1,  -500.00,    2, 1, 21),
    ('Auto Loan Payment',                    '2024-09-18',  1,  -385.00,    5, 1, 54),
    ('Streaming Subscription',               '2024-09-20',  1,   -15.99, NULL, 2, 36),
    ('Gas Station',                          '2024-09-25',  1,   -52.40, NULL, 2, 40),

    -- Savings deposits (account_id = 2)
    ('Transfer from Checking',               '2024-07-16',  2,   500.00,    1, 1,  5),
    ('Transfer from Checking',               '2024-08-16',  2,   500.00,    1, 1,  5),
    ('Transfer from Checking',               '2024-09-16',  2,   500.00,    1, 1,  5),
    ('Interest Earned',                      '2024-09-30',  2,     3.75, NULL, 4, 51),

    -- Credit card transactions (account_id = 3)
    ('Online Shopping',                      '2024-07-02',  3,  -189.99, NULL, 2, 46),
    ('Restaurant',                           '2024-07-14',  3,   -55.00, NULL, 2, 33),
    ('Payment Received',                     '2024-07-05',  3,   325.00,    1, 1,  1),
    ('Entertainment',                        '2024-08-03',  3,   -75.00, NULL, 2, 34),
    ('Grocery Store',                        '2024-08-10',  3,  -134.50, NULL, 2, 24),
    ('Payment Received',                     '2024-08-05',  3,   410.00,    1, 1,  1),
    ('Auto Repair',                          '2024-09-08',  3,  -275.00, NULL, 2, 47),
    ('Payment Received',                     '2024-09-05',  3,   275.00,    1, 1,  1),

    -- Vacation savings (account_id = 7)
    ('Transfer from Checking',               '2024-08-01',  7,   200.00,    1, 1,  5),
    ('Transfer from Checking',               '2024-09-01',  7,   200.00,    1, 1,  5);
