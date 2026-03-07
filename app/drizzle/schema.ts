import { pgTable, foreignKey, serial, text, integer, date, numeric, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const accounts = pgTable("accounts", {
	accountId: serial("account_id").primaryKey().notNull(),
	accountName: text("account_name").notNull(),
	accountTypeId: integer("account_type_id").notNull(),
	accountIdentifier: text("account_identifier"),
	closedDate: date("closed_date"),
	openedDate: date("opened_date"),
}, (table) => [
	foreignKey({
			columns: [table.accountTypeId],
			foreignColumns: [accountTypes.accountTypeId],
			name: "accounts_account_type_id_fkey"
		}),
]);

export const accountTypeCategories = pgTable("account_type_categories", {
	accountTypeCategoryId: integer("account_type_category_id").primaryKey().generatedAlwaysAsIdentity({ name: "account_type_categories_account_type_category_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	accountTypeCategory: text("account_type_category").notNull(),
});

export const accountTypes = pgTable("account_types", {
	accountTypeId: integer("account_type_id").primaryKey().generatedAlwaysAsIdentity({ name: "account_types_account_type_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	accountType: text("account_type").notNull(),
	accountTypeCategoryId: integer("account_type_category_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.accountTypeCategoryId],
			foreignColumns: [accountTypeCategories.accountTypeCategoryId],
			name: "account_types_account_type_category_id_fkey"
		}),
]);

export const transactions = pgTable("transactions", {
	transactionId: serial("transaction_id").primaryKey().notNull(),
	transactionDescription: text("transaction_description").notNull(),
	transactionDate: date("transaction_date").notNull(),
	accountId: integer("account_id").notNull(),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	relatedAccountId: integer("related_account_id"),
	transactionTypeId: integer("transaction_type_id").notNull(),
	transactionCategoryId: integer("transaction_category_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.accountId],
			name: "transactions_account_id_fkey"
		}),
	foreignKey({
			columns: [table.relatedAccountId],
			foreignColumns: [accounts.accountId],
			name: "transactions_related_account_id_fkey"
		}),
	foreignKey({
			columns: [table.transactionCategoryId],
			foreignColumns: [transactionCategories.transactionCategoryId],
			name: "transactions_transaction_category_id_fkey"
		}),
	foreignKey({
			columns: [table.transactionTypeId],
			foreignColumns: [transactionTypes.transactionTypeId],
			name: "transactions_transaction_type_id_fkey"
		}),
]);

export const transactionCategories = pgTable("transaction_categories", {
	transactionCategoryId: integer("transaction_category_id").primaryKey().generatedAlwaysAsIdentity({ name: "transaction_type_categories_transaction_type_category_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	transactionCategory: text("transaction_category").notNull(),
});

export const transactionTypes = pgTable("transaction_types", {
	transactionTypeId: integer("transaction_type_id").primaryKey().generatedAlwaysAsIdentity({ name: "transaction_types_transaction_type_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	transactionType: text("transaction_type").notNull(),
});

export const accountBalanceHistory = pgTable("account_balance_history", {
	accountId: integer("account_id").notNull(),
	balanceDate: date("balance_date").notNull(),
	dailyBalance: numeric("daily_balance", { precision: 15, scale:  2 }).default('0').notNull(),
	cumulativeBalance: numeric("cumulative_balance", { precision: 15, scale:  2 }).default('0').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.accountId],
			name: "account_balance_history_account_id_fkey"
		}),
	primaryKey({ columns: [table.balanceDate, table.accountId], name: "account_balance_history_pkey"}),
]);
