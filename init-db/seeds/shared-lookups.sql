-- ==============================================
-- Shared lookup seed — runs against both Finances and Finances_Test.
--
-- Seeds the two lookup tables that must stay identical across databases:
--   - account_type_categories (6 rows)
--   - transaction_types (12 rows)
--
-- Purely additive: ON CONFLICT DO NOTHING ensures existing rows are never
-- overwritten, so this file is safe to run against a populated Finances DB.
-- (The init shell script also guards the Finances call behind a row-count
-- check; this is the last line of defense.)
--
-- Finances_Test drift is corrected at test-suite startup by
-- app/tests/integration/vitest-setup.ts, which uses DO UPDATE.
-- ==============================================

INSERT INTO account_type_categories (account_type_category_id, account_type_category)
OVERRIDING SYSTEM VALUE VALUES
    (1, 'Current Asset'),
    (2, 'Restricted Asset'),
    (3, 'Fixed Asset'),
    (4, 'Investment'),
    (5, 'Current Liability'),
    (6, 'Non-current Liability')
ON CONFLICT (account_type_category_id) DO NOTHING;

INSERT INTO transaction_types (transaction_type_id, transaction_type)
OVERRIDING SYSTEM VALUE VALUES
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
    (11, 'Asset Re-Evaluation'),
    (12, 'Opening Balance')
ON CONFLICT (transaction_type_id) DO NOTHING;

-- Advance IDENTITY sequences past the highest explicit ID so future
-- auto-generated inserts do not collide with the seeded values.
SELECT setval(
    pg_get_serial_sequence('account_type_categories', 'account_type_category_id'),
    GREATEST((SELECT MAX(account_type_category_id) FROM account_type_categories), 1)
);

SELECT setval(
    pg_get_serial_sequence('transaction_types', 'transaction_type_id'),
    GREATEST((SELECT MAX(transaction_type_id) FROM transaction_types), 1)
);

-- ==============================================
-- account_types.liquidity_class defaults
--
-- This file does not seed account_types rows themselves (those are
-- user-created in Finances and fixture-seeded in Finances_Test), but
-- when rows with these known account_type names exist, fill in the
-- liquidity_class default. Idempotent: WHERE liquidity_class IS NULL
-- so user overrides are never clobbered. Liabilities intentionally
-- remain NULL.
-- ==============================================

UPDATE account_types SET liquidity_class = 'liquid'
    WHERE liquidity_class IS NULL AND account_type IN (
        'Cash & Cash Equivalent','Accounts Receivable',
        'Checking Account','Savings Account');

UPDATE account_types SET liquidity_class = 'semi_liquid'
    WHERE liquidity_class IS NULL AND account_type IN (
        'Short-term Investment','Stock, Bond, or Mutual Fund',
        'Cryptocurrency','Certificate of Deposit');

UPDATE account_types SET liquidity_class = 'illiquid'
    WHERE liquidity_class IS NULL AND account_type IN (
        'Real Estate','Vehicle','Retirement Account');

UPDATE account_types SET liquidity_class = 'restricted'
    WHERE liquidity_class IS NULL AND account_type IN (
        'Escrow Account','Security Deposit','Earmarked');
