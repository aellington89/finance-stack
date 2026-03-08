import { relations } from "drizzle-orm/relations";
import { accounts, transactions, transactionCategories, transactionTypes, accountTypes, accountTypeCategories, accountBalanceHistory } from "./schema";

export const transactionsRelations = relations(transactions, ({one}) => ({
	account_accountId: one(accounts, {
		fields: [transactions.accountId],
		references: [accounts.accountId],
		relationName: "transactions_accountId_accounts_accountId"
	}),
	account_relatedAccountId: one(accounts, {
		fields: [transactions.relatedAccountId],
		references: [accounts.accountId],
		relationName: "transactions_relatedAccountId_accounts_accountId"
	}),
	transactionCategory: one(transactionCategories, {
		fields: [transactions.transactionCategoryId],
		references: [transactionCategories.transactionCategoryId]
	}),
	transactionType: one(transactionTypes, {
		fields: [transactions.transactionTypeId],
		references: [transactionTypes.transactionTypeId]
	}),
}));

export const accountsRelations = relations(accounts, ({one, many}) => ({
	transactions_accountId: many(transactions, {
		relationName: "transactions_accountId_accounts_accountId"
	}),
	transactions_relatedAccountId: many(transactions, {
		relationName: "transactions_relatedAccountId_accounts_accountId"
	}),
	accountType: one(accountTypes, {
		fields: [accounts.accountTypeId],
		references: [accountTypes.accountTypeId]
	}),
	accountBalanceHistories: many(accountBalanceHistory),
}));

export const transactionCategoriesRelations = relations(transactionCategories, ({many}) => ({
	transactions: many(transactions),
}));

export const transactionTypesRelations = relations(transactionTypes, ({many}) => ({
	transactions: many(transactions),
}));

export const accountTypesRelations = relations(accountTypes, ({one, many}) => ({
	accounts: many(accounts),
	accountTypeCategory: one(accountTypeCategories, {
		fields: [accountTypes.accountTypeCategoryId],
		references: [accountTypeCategories.accountTypeCategoryId]
	}),
}));

export const accountTypeCategoriesRelations = relations(accountTypeCategories, ({many}) => ({
	accountTypes: many(accountTypes),
}));

export const accountBalanceHistoryRelations = relations(accountBalanceHistory, ({one}) => ({
	account: one(accounts, {
		fields: [accountBalanceHistory.accountId],
		references: [accounts.accountId]
	}),
}));