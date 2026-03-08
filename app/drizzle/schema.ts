import { pgTable, index, foreignKey, serial, text, date, integer, numeric, primaryKey, pgView } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



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
	index("idx_transactions_account_date").using("btree", table.accountId.asc().nullsLast().op("int4_ops"), table.transactionDate.asc().nullsLast().op("int4_ops")),
	index("idx_transactions_category").using("btree", table.transactionCategoryId.asc().nullsLast().op("int4_ops")),
	index("idx_transactions_date").using("btree", table.transactionDate.asc().nullsLast().op("date_ops")),
	index("idx_transactions_type").using("btree", table.transactionTypeId.asc().nullsLast().op("int4_ops")),
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

export const accountTypeCategories = pgTable("account_type_categories", {
	accountTypeCategoryId: integer("account_type_category_id").primaryKey().generatedAlwaysAsIdentity({ name: "account_type_categories_account_type_category_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	accountTypeCategory: text("account_type_category").notNull(),
});

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
	index("idx_balance_history_date").using("btree", table.balanceDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.accountId],
			name: "account_balance_history_account_id_fkey"
		}),
	primaryKey({ columns: [table.balanceDate, table.accountId], name: "account_balance_history_pkey"}),
]);
export const vTransactionsFull = pgView("v_transactions_full", {	transactionId: integer("transaction_id"),
	transactionDescription: text("transaction_description"),
	transactionDate: date("transaction_date"),
	amount: numeric({ precision: 15, scale:  2 }),
	accountId: integer("account_id"),
	relatedAccountId: integer("related_account_id"),
	accountName: text("account_name"),
	accountTypeId: integer("account_type_id"),
	accountType: text("account_type"),
	accountTypeCategory: text("account_type_category"),
	relatedAccountName: text("related_account_name"),
	transactionTypeId: integer("transaction_type_id"),
	transactionType: text("transaction_type"),
	transactionCategoryId: integer("transaction_category_id"),
	transactionCategory: text("transaction_category"),
}).as(sql`SELECT t.transaction_id, t.transaction_description, t.transaction_date, t.amount, t.account_id, t.related_account_id, a.account_name, a.account_type_id, at.account_type, atc.account_type_category, ra.account_name AS related_account_name, tt.transaction_type_id, tt.transaction_type, tc.transaction_category_id, tc.transaction_category FROM transactions t JOIN accounts a USING (account_id) JOIN account_types at USING (account_type_id) JOIN account_type_categories atc USING (account_type_category_id) LEFT JOIN accounts ra ON t.related_account_id = ra.account_id JOIN transaction_types tt USING (transaction_type_id) JOIN transaction_categories tc USING (transaction_category_id)`);
export const vAccountBalancesCurrent = pgView("v_account_balances_current", {
	accountId: integer("account_id"),
	accountName: text("account_name"),
	accountType: text("account_type"),
	accountTypeCategory: text("account_type_category"),
	accountTypeCategoryId: integer("account_type_category_id"),
	currentBalance: numeric("current_balance", { precision: 15, scale: 2 }),
	balanceDate: date("balance_date"),
}).as(sql`SELECT abh.account_id, a.account_name, at.account_type, atc.account_type_category, atc.account_type_category_id, abh.cumulative_balance AS current_balance, abh.balance_date FROM account_balance_history abh JOIN accounts a USING (account_id) JOIN account_types at USING (account_type_id) JOIN account_type_categories atc USING (account_type_category_id) WHERE abh.balance_date = (SELECT max(balance_date) FROM account_balance_history WHERE account_id = abh.account_id)`);