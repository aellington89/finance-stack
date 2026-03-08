-- ==============================================
-- Finance Stack Schema
-- Extracted from production via:
--   docker exec postgres pg_dump -U postgres -d Finances --schema-only --no-owner --no-privileges
-- Apply to any target database with:
--   psql -U postgres -d <database_name> -f schema.sql
-- ==============================================

-- --------------------------------------------
-- Lookup tables (no foreign key dependencies)
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_type_categories (
    account_type_category_id integer NOT NULL,
    account_type_category text NOT NULL
);

ALTER TABLE public.account_type_categories ALTER COLUMN account_type_category_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.account_type_categories_account_type_category_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS public.account_types (
    account_type_id integer NOT NULL,
    account_type text NOT NULL,
    account_type_category_id integer NOT NULL
);

ALTER TABLE public.account_types ALTER COLUMN account_type_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.account_types_account_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS public.transaction_categories (
    transaction_category_id integer NOT NULL,
    transaction_category text NOT NULL
);

ALTER TABLE public.transaction_categories ALTER COLUMN transaction_category_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.transaction_type_categories_transaction_type_category_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS public.transaction_types (
    transaction_type_id integer NOT NULL,
    transaction_type text NOT NULL
);

ALTER TABLE public.transaction_types ALTER COLUMN transaction_type_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.transaction_types_transaction_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- --------------------------------------------
-- Core tables
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounts (
    account_id integer NOT NULL,
    account_name text NOT NULL,
    account_type_id integer NOT NULL,
    account_identifier text,
    closed_date date,
    opened_date date
);

COMMENT ON TABLE public.accounts IS 'All accounts that contribute transactions.';

CREATE SEQUENCE IF NOT EXISTS public.accounts_account_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.accounts_account_id_seq OWNED BY public.accounts.account_id;

ALTER TABLE ONLY public.accounts ALTER COLUMN account_id SET DEFAULT nextval('public.accounts_account_id_seq'::regclass);

CREATE TABLE IF NOT EXISTS public.transactions (
    transaction_id integer NOT NULL,
    transaction_description text NOT NULL,
    transaction_date date NOT NULL,
    account_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    related_account_id integer,
    transaction_type_id integer NOT NULL,
    transaction_category_id integer NOT NULL
);

COMMENT ON TABLE public.transactions IS 'A table to record every transaction that occurs on every account.';

CREATE SEQUENCE IF NOT EXISTS public.transactions_transaction_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.transactions_transaction_id_seq OWNED BY public.transactions.transaction_id;

ALTER TABLE ONLY public.transactions ALTER COLUMN transaction_id SET DEFAULT nextval('public.transactions_transaction_id_seq'::regclass);

CREATE TABLE IF NOT EXISTS public.account_balance_history (
    account_id integer NOT NULL,
    balance_date date NOT NULL,
    daily_balance numeric(15,2) DEFAULT 0 NOT NULL,
    cumulative_balance numeric(15,2) DEFAULT 0 NOT NULL
);

-- --------------------------------------------
-- Primary keys
-- --------------------------------------------

ALTER TABLE ONLY public.account_type_categories
    ADD CONSTRAINT account_type_categories_pkey PRIMARY KEY (account_type_category_id);

ALTER TABLE ONLY public.account_types
    ADD CONSTRAINT account_type_pkey PRIMARY KEY (account_type_id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (account_id);

ALTER TABLE ONLY public.transaction_categories
    ADD CONSTRAINT transaction_categories_pkey PRIMARY KEY (transaction_category_id);

ALTER TABLE ONLY public.transaction_types
    ADD CONSTRAINT transaction_types_pkey PRIMARY KEY (transaction_type_id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (transaction_id);

ALTER TABLE ONLY public.account_balance_history
    ADD CONSTRAINT account_balance_history_pkey PRIMARY KEY (account_id, balance_date);

-- --------------------------------------------
-- Foreign keys
-- --------------------------------------------

ALTER TABLE ONLY public.account_types
    ADD CONSTRAINT account_types_account_type_category_id_fkey FOREIGN KEY (account_type_category_id) REFERENCES public.account_type_categories(account_type_category_id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_account_type_id_fkey FOREIGN KEY (account_type_id) REFERENCES public.account_types(account_type_id);

ALTER TABLE ONLY public.account_balance_history
    ADD CONSTRAINT account_balance_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_related_account_id_fkey FOREIGN KEY (related_account_id) REFERENCES public.accounts(account_id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_transaction_category_id_fkey FOREIGN KEY (transaction_category_id) REFERENCES public.transaction_categories(transaction_category_id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_transaction_type_id_fkey FOREIGN KEY (transaction_type_id) REFERENCES public.transaction_types(transaction_type_id);

-- --------------------------------------------
-- Indexes
-- --------------------------------------------

CREATE INDEX IF NOT EXISTS idx_transactions_date
    ON public.transactions (transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
    ON public.transactions (account_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_category
    ON public.transactions (transaction_category_id);

CREATE INDEX IF NOT EXISTS idx_transactions_type
    ON public.transactions (transaction_type_id);

CREATE INDEX IF NOT EXISTS idx_balance_history_date
    ON public.account_balance_history (balance_date);

-- --------------------------------------------
-- Views
-- --------------------------------------------

CREATE OR REPLACE VIEW public.v_transactions_full AS
SELECT
    t.transaction_id, t.transaction_description, t.transaction_date,
    t.amount, t.account_id, t.related_account_id,
    a.account_name, a.account_type_id,
    at.account_type, atc.account_type_category,
    ra.account_name AS related_account_name,
    tt.transaction_type_id, tt.transaction_type,
    tc.transaction_category_id, tc.transaction_category
FROM transactions t
JOIN accounts a USING (account_id)
JOIN account_types at USING (account_type_id)
JOIN account_type_categories atc USING (account_type_category_id)
LEFT JOIN accounts ra ON t.related_account_id = ra.account_id
JOIN transaction_types tt USING (transaction_type_id)
JOIN transaction_categories tc USING (transaction_category_id);

CREATE OR REPLACE VIEW public.v_account_balances_current AS
SELECT
    abh.account_id, a.account_name,
    at.account_type, atc.account_type_category,
    atc.account_type_category_id,
    abh.cumulative_balance AS current_balance,
    abh.balance_date
FROM account_balance_history abh
JOIN accounts a USING (account_id)
JOIN account_types at USING (account_type_id)
JOIN account_type_categories atc USING (account_type_category_id)
WHERE abh.balance_date = (
    SELECT MAX(balance_date) FROM account_balance_history
    WHERE account_id = abh.account_id
);
