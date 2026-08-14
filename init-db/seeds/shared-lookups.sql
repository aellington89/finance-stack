-- ==============================================
-- Shared lookup seed — runs against both Finances and Finances_Test.
--
-- Seeds the app-owned reference rows that must stay identical across databases:
--   - account_type_categories (6 rows)
--   - transaction_types (12 rows)
--   - transaction_categories (1 row — see below)
--
-- transaction_categories is the odd one out: the table is user-managed, and
-- only the single row the application itself writes ships here. See the
-- seed-data taxonomy in docs/database.md for which rows belong in this file
-- and which are the user's (issue #178).
--
-- CONTRACT (issue #187): this file is applied UNCONDITIONALLY to the live
-- Finances database on every migrate run — there is no longer a row-count guard
-- in front of it, because that guard is what left production permanently
-- missing transaction_types id=12. Its own idempotency is therefore the only
-- thing standing between an edit here and real user data. Every statement must
-- be additive and safe to re-run against a populated database:
--
--   * INSERT ... ON CONFLICT DO NOTHING   -- never DO UPDATE: that overwrites
--   * SELECT setval(...)
--   * UPDATE ... WHERE <guard>            -- never unconditional
--   * no DELETE, TRUNCATE, DROP or ALTER
--
-- `npm run check:seed-references` enforces exactly that list, so a violation
-- fails CI rather than production.
--
-- Finances_Test drift is corrected at test-suite startup by
-- app/tests/integration/vitest-setup.ts, which uses DO UPDATE. That is safe
-- there and would not be here — Finances_Test holds fixtures, Finances holds
-- the user's records.
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

-- transaction_categories is a user-managed table, and this is the one row that
-- is not the user's: createAccount() writes it on every account opened with an
-- initial balance (OPENING_BALANCE_CATEGORY in app/lib/constants/reference-ids.ts),
-- so the app depends on it existing before the user has created anything. Until
-- issue #178 it was asserted by /api/health/seed-data but shipped nowhere, so a
-- brand-new Finances legitimately reported drift.
--
-- DO NOTHING is doing real work here beyond re-runnability: on an existing
-- database this row is already present, and quite possibly renamed by the user
-- via /settings/categories. It stays renamed — the drift check reports it, and
-- repairing it is the user's call, not this file's.
--
-- Nothing else from transaction_categories belongs here. In particular the IDs
-- pinned by app/lib/queries/liability-categories.ts are user data, not app-owned
-- reference rows; issue #111 is what lets those rows opt into the Liabilities
-- aggregates without being shipped.
INSERT INTO transaction_categories (transaction_category_id, transaction_category)
OVERRIDING SYSTEM VALUE VALUES
    (6, 'Other')
ON CONFLICT (transaction_category_id) DO NOTHING;

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

-- GREATEST(..., 1) matters more here than above: transaction_categories is
-- user-populated, so MAX() is normally far past 6 and this must not rewind the
-- sequence. Against Finances_Test this runs before finances-test-mock-data.sql,
-- which seeds IDs up to 80 and re-runs its own setval afterwards.
SELECT setval(
    pg_get_serial_sequence('transaction_categories', 'transaction_category_id'),
    GREATEST((SELECT MAX(transaction_category_id) FROM transaction_categories), 1)
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
--
-- Each statement is additionally scoped to the four ASSET categories
-- (1 Current Asset, 2 Restricted Asset, 3 Fixed Asset, 4 Investment) — the
-- same set as ASSET_CATEGORY_IDS in app/lib/queries/assets-drilldown.ts.
-- Matching on account_type alone would classify a liability that happens to
-- share one of these names, e.g. a user-created 'Earmarked' filed under
-- Current Liability. That is inert today (getLiquidityBreakdown and
-- getAssetTrendDecomposition both filter to the asset categories before
-- reading liquidity_class, and no liability query reads the column at all),
-- but the guard keeps "liabilities remain NULL" true by construction rather
-- than by the naming convention holding (issue #187).
--
-- Note liquidity_class does NOT decide asset vs. liability anywhere — that is
-- account_type_category_id alone. Setting it can never move an account
-- between the two.
-- ==============================================

UPDATE account_types SET liquidity_class = 'liquid'
    WHERE liquidity_class IS NULL AND account_type_category_id IN (1,2,3,4)
      AND account_type IN (
        'Cash & Cash Equivalent','Accounts Receivable',
        'Checking Account','Savings Account');

UPDATE account_types SET liquidity_class = 'semi_liquid'
    WHERE liquidity_class IS NULL AND account_type_category_id IN (1,2,3,4)
      AND account_type IN (
        'Short-term Investment','Stock, Bond, or Mutual Fund',
        'Cryptocurrency','Certificate of Deposit');

UPDATE account_types SET liquidity_class = 'illiquid'
    WHERE liquidity_class IS NULL AND account_type_category_id IN (1,2,3,4)
      AND account_type IN (
        'Real Estate','Vehicle','Retirement Account');

UPDATE account_types SET liquidity_class = 'restricted'
    WHERE liquidity_class IS NULL AND account_type_category_id IN (1,2,3,4)
      AND account_type IN (
        'Escrow Account','Security Deposit','Earmarked');
