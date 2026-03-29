import { db } from "@/lib/db";
import {
  transactionCategories,
  transactionTypes,
  accountTypeCategories,
  accountTypes,
} from "@/drizzle/schema";
import { asc, eq } from "drizzle-orm";

export async function getTransactionCategories() {
  return db
    .select({
      transactionCategoryId: transactionCategories.transactionCategoryId,
      transactionCategory: transactionCategories.transactionCategory,
    })
    .from(transactionCategories)
    .orderBy(asc(transactionCategories.transactionCategory));
}

export async function getTransactionTypes() {
  return db
    .select({
      transactionTypeId: transactionTypes.transactionTypeId,
      transactionType: transactionTypes.transactionType,
    })
    .from(transactionTypes)
    .orderBy(asc(transactionTypes.transactionType));
}

export async function getAccountTypeCategories() {
  return db
    .select({
      accountTypeCategoryId: accountTypeCategories.accountTypeCategoryId,
      accountTypeCategory: accountTypeCategories.accountTypeCategory,
    })
    .from(accountTypeCategories)
    .orderBy(asc(accountTypeCategories.accountTypeCategory));
}

export async function getAccountTypes() {
  return db
    .select({
      accountTypeId: accountTypes.accountTypeId,
      accountType: accountTypes.accountType,
      accountTypeCategoryId: accountTypes.accountTypeCategoryId,
      accountTypeCategory: accountTypeCategories.accountTypeCategory,
    })
    .from(accountTypes)
    .innerJoin(
      accountTypeCategories,
      eq(accountTypes.accountTypeCategoryId, accountTypeCategories.accountTypeCategoryId)
    )
    .orderBy(
      asc(accountTypeCategories.accountTypeCategory),
      asc(accountTypes.accountType)
    );
}

export type TransactionCategoryRow = Awaited<ReturnType<typeof getTransactionCategories>>[number];
export type TransactionTypeRow = Awaited<ReturnType<typeof getTransactionTypes>>[number];
export type AccountTypeCategoryRow = Awaited<ReturnType<typeof getAccountTypeCategories>>[number];
export type AccountTypeRow = Awaited<ReturnType<typeof getAccountTypes>>[number];
