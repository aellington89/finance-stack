import { relations } from "drizzle-orm/relations";
import { accounts, transactions, transactionCategories, transactionTypes, accountTypeCategories, accountTypes, accountBalanceHistory, balanceTransfers, recurringTransactions } from "./schema";

export const transactionsRelations = relations(transactions, ({one, many}) => ({
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
	balanceTransfers_transferTransactionId: many(balanceTransfers, {
		relationName: "balanceTransfers_transferTransactionId_transactions_transactionId"
	}),
	balanceTransfers_feeTransactionId: many(balanceTransfers, {
		relationName: "balanceTransfers_feeTransactionId_transactions_transactionId"
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
	recurringTransactions_accountId: many(recurringTransactions, {
		relationName: "recurringTransactions_accountId_accounts_accountId"
	}),
	recurringTransactions_relatedAccountId: many(recurringTransactions, {
		relationName: "recurringTransactions_relatedAccountId_accounts_accountId"
	}),
}));

export const transactionCategoriesRelations = relations(transactionCategories, ({many}) => ({
	transactions: many(transactions),
	recurringTransactions: many(recurringTransactions),
}));

export const transactionTypesRelations = relations(transactionTypes, ({many}) => ({
	transactions: many(transactions),
	recurringTransactions: many(recurringTransactions),
}));

export const accountTypesRelations = relations(accountTypes, ({one, many}) => ({
	accountTypeCategory: one(accountTypeCategories, {
		fields: [accountTypes.accountTypeCategoryId],
		references: [accountTypeCategories.accountTypeCategoryId]
	}),
	accounts: many(accounts),
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
export const balanceTransfersRelations = relations(balanceTransfers, ({one}) => ({
	transaction_transferTransactionId: one(transactions, {
		fields: [balanceTransfers.transferTransactionId],
		references: [transactions.transactionId],
		relationName: "balanceTransfers_transferTransactionId_transactions_transactionId"
	}),
	transaction_feeTransactionId: one(transactions, {
		fields: [balanceTransfers.feeTransactionId],
		references: [transactions.transactionId],
		relationName: "balanceTransfers_feeTransactionId_transactions_transactionId"
	}),
}));
export const recurringTransactionsRelations = relations(recurringTransactions, ({one}) => ({
	account_accountId: one(accounts, {
		fields: [recurringTransactions.accountId],
		references: [accounts.accountId],
		relationName: "recurringTransactions_accountId_accounts_accountId"
	}),
	account_relatedAccountId: one(accounts, {
		fields: [recurringTransactions.relatedAccountId],
		references: [accounts.accountId],
		relationName: "recurringTransactions_relatedAccountId_accounts_accountId"
	}),
	transactionCategory: one(transactionCategories, {
		fields: [recurringTransactions.transactionCategoryId],
		references: [transactionCategories.transactionCategoryId]
	}),
	transactionType: one(transactionTypes, {
		fields: [recurringTransactions.transactionTypeId],
		references: [transactionTypes.transactionTypeId]
	}),
}));
