CREATE TABLE "account_balance_history" (
	"account_id" integer NOT NULL,
	"balance_date" date NOT NULL,
	"daily_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cumulative_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "account_balance_history_pkey" PRIMARY KEY("account_id","balance_date")
);
--> statement-breakpoint
CREATE TABLE "account_type_categories" (
	"account_type_category_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_type_categories_account_type_category_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_type_category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_types" (
	"account_type_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_types_account_type_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_type" text NOT NULL,
	"account_type_category_id" integer NOT NULL,
	"liquidity_class" text,
	CONSTRAINT "account_types_liquidity_class_check" CHECK (liquidity_class = ANY (ARRAY['liquid'::text, 'semi_liquid'::text, 'illiquid'::text, 'restricted'::text]))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"account_id" serial PRIMARY KEY NOT NULL,
	"account_name" text NOT NULL,
	"account_type_id" integer NOT NULL,
	"account_identifier" text,
	"closed_date" date,
	"opened_date" date,
	"liquidity_class" text,
	CONSTRAINT "accounts_liquidity_class_check" CHECK (liquidity_class = ANY (ARRAY['liquid'::text, 'semi_liquid'::text, 'illiquid'::text, 'restricted'::text]))
);
--> statement-breakpoint
CREATE TABLE "transaction_categories" (
	"transaction_category_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transaction_type_categories_transaction_type_category_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_types" (
	"transaction_type_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transaction_types_transaction_type_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"transaction_id" serial PRIMARY KEY NOT NULL,
	"transaction_description" text NOT NULL,
	"transaction_date" date NOT NULL,
	"account_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"related_account_id" integer,
	"transaction_type_id" integer NOT NULL,
	"transaction_category_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_balance_history" ADD CONSTRAINT "account_balance_history_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_types" ADD CONSTRAINT "account_types_account_type_category_id_fkey" FOREIGN KEY ("account_type_category_id") REFERENCES "public"."account_type_categories"("account_type_category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "public"."account_types"("account_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_related_account_id_fkey" FOREIGN KEY ("related_account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transaction_category_id_fkey" FOREIGN KEY ("transaction_category_id") REFERENCES "public"."transaction_categories"("transaction_category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transaction_type_id_fkey" FOREIGN KEY ("transaction_type_id") REFERENCES "public"."transaction_types"("transaction_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_balance_history_date" ON "account_balance_history" USING btree ("balance_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_account_date" ON "transactions" USING btree ("account_id" int4_ops,"transaction_date" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_category" ON "transactions" USING btree ("transaction_category_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_date" ON "transactions" USING btree ("transaction_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_type" ON "transactions" USING btree ("transaction_type_id" int4_ops);--> statement-breakpoint
CREATE VIEW "public"."v_account_balances_current" AS (SELECT abh.account_id, a.account_name, at.account_type, atc.account_type_category, atc.account_type_category_id, abh.cumulative_balance AS current_balance, abh.balance_date FROM account_balance_history abh JOIN accounts a USING (account_id) JOIN account_types at USING (account_type_id) JOIN account_type_categories atc USING (account_type_category_id) WHERE abh.balance_date = (( SELECT max(account_balance_history.balance_date) AS max FROM account_balance_history WHERE account_balance_history.account_id = abh.account_id)));--> statement-breakpoint
CREATE VIEW "public"."v_daily_totals" AS (SELECT t.transaction_date, tt.transaction_type, sum(t.amount) AS daily_total FROM transactions t JOIN transaction_types tt USING (transaction_type_id) GROUP BY t.transaction_date, tt.transaction_type);--> statement-breakpoint
CREATE VIEW "public"."v_transactions_full" AS (SELECT t.transaction_id, t.transaction_description, t.transaction_date, t.amount, t.account_id, t.related_account_id, a.account_name, a.account_type_id, at.account_type, atc.account_type_category, ra.account_name AS related_account_name, tt.transaction_type_id, tt.transaction_type, tc.transaction_category_id, tc.transaction_category FROM transactions t JOIN accounts a USING (account_id) JOIN account_types at USING (account_type_id) JOIN account_type_categories atc USING (account_type_category_id) LEFT JOIN accounts ra ON t.related_account_id = ra.account_id JOIN transaction_types tt USING (transaction_type_id) JOIN transaction_categories tc USING (transaction_category_id));--> statement-breakpoint
COMMENT ON TABLE "accounts" IS 'All accounts that contribute transactions.';--> statement-breakpoint
COMMENT ON TABLE "transactions" IS 'A table to record every transaction that occurs on every account.';