-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "accounts" (
	"account_id" serial PRIMARY KEY NOT NULL,
	"account_name" text NOT NULL,
	"account_type_id" integer NOT NULL,
	"account_identifier" text,
	"closed_date" date,
	"opened_date" date
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
	"account_type_category_id" integer NOT NULL
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
CREATE TABLE "account_balance_history" (
	"account_id" integer NOT NULL,
	"balance_date" date NOT NULL,
	"daily_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cumulative_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "account_balance_history_pkey" PRIMARY KEY("balance_date","account_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "public"."account_types"("account_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_types" ADD CONSTRAINT "account_types_account_type_category_id_fkey" FOREIGN KEY ("account_type_category_id") REFERENCES "public"."account_type_categories"("account_type_category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_related_account_id_fkey" FOREIGN KEY ("related_account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transaction_category_id_fkey" FOREIGN KEY ("transaction_category_id") REFERENCES "public"."transaction_categories"("transaction_category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transaction_type_id_fkey" FOREIGN KEY ("transaction_type_id") REFERENCES "public"."transaction_types"("transaction_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balance_history" ADD CONSTRAINT "account_balance_history_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;
*/