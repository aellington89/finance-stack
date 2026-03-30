import { db } from "@/lib/db";
import { eq, or, sql } from "drizzle-orm";
import {
  accounts,
  accountTypes,
  accountTypeCategories,
  transactions,
} from "@/drizzle/schema";

export interface AccountBalanceRow {
  accountTypeCategory: string | null;
  accountType: string | null;
  accountName: string | null;
  balance: number;
}

export async function getAccountBalances(): Promise<AccountBalanceRow[]> {
  // GROUP BY ROLLUP produces subtotal rows (account_type_category + account_type
  // subtotals) and a grand-total row. Those rows have NULL in the grouped columns,
  // which the caller uses to distinguish summary rows from leaf rows.
  const result = await db.execute(sql`
    SELECT
      atc.account_type_category,
      at.account_type,
      a.account_name,
      SUM(abh.cumulative_balance) AS balance
    FROM account_balance_history abh
    JOIN accounts a USING (account_id)
    JOIN account_types at USING (account_type_id)
    JOIN account_type_categories atc USING (account_type_category_id)
    WHERE a.closed_date IS NULL
    AND abh.balance_date = (
      SELECT MAX(balance_date) FROM account_balance_history
      WHERE account_id = abh.account_id
    )
    GROUP BY ROLLUP(atc.account_type_category, at.account_type, a.account_name)
    ORDER BY
      atc.account_type_category NULLS LAST,
      at.account_type NULLS LAST,
      a.account_name NULLS LAST
  `);

  return (
    result.rows as {
      account_type_category: string | null;
      account_type: string | null;
      account_name: string | null;
      balance: string;
    }[]
  ).map((row) => ({
    accountTypeCategory: row.account_type_category,
    accountType: row.account_type,
    accountName: row.account_name,
    balance: parseFloat(row.balance) || 0,
  }));
}

export async function getAccountTypes(): Promise<
  { id: number; name: string }[]
> {
  const rows = await db
    .select({
      id: accountTypes.accountTypeId,
      type: accountTypes.accountType,
      category: accountTypeCategories.accountTypeCategory,
    })
    .from(accountTypes)
    .innerJoin(
      accountTypeCategories,
      eq(
        accountTypes.accountTypeCategoryId,
        accountTypeCategories.accountTypeCategoryId
      )
    )
    .orderBy(
      accountTypeCategories.accountTypeCategory,
      accountTypes.accountType
    );

  return rows.map((r) => ({ id: r.id, name: `${r.type} (${r.category})` }));
}

export interface AccountRow {
  accountId: number;
  accountName: string;
  accountTypeId: number;
  accountType: string;
  accountTypeCategory: string;
  accountIdentifier: string | null;
  openedDate: string | null;
  closedDate: string | null;
}

export async function getAccountById(
  accountId: number
): Promise<AccountRow | null> {
  const rows = await db
    .select({
      accountId: accounts.accountId,
      accountName: accounts.accountName,
      accountTypeId: accounts.accountTypeId,
      accountType: accountTypes.accountType,
      accountTypeCategory: accountTypeCategories.accountTypeCategory,
      accountIdentifier: accounts.accountIdentifier,
      openedDate: accounts.openedDate,
      closedDate: accounts.closedDate,
    })
    .from(accounts)
    .innerJoin(accountTypes, eq(accounts.accountTypeId, accountTypes.accountTypeId))
    .innerJoin(
      accountTypeCategories,
      eq(
        accountTypes.accountTypeCategoryId,
        accountTypeCategories.accountTypeCategoryId
      )
    )
    .where(eq(accounts.accountId, accountId))
    .limit(1);

  return rows[0] ?? null;
}

export interface AccountListRow {
  accountId: number;
  accountName: string;
  accountTypeId: number;
  accountType: string;
  accountTypeCategory: string;
  accountIdentifier: string | null;
  openedDate: string | null;
  closedDate: string | null;
  balance: number;
}

export async function getAccountsList(): Promise<AccountListRow[]> {
  const result = await db.execute(sql`
    SELECT
      a.account_id,
      a.account_name,
      at.account_type_id,
      at.account_type,
      atc.account_type_category,
      a.account_identifier,
      a.opened_date,
      a.closed_date,
      COALESCE(v.current_balance, 0) AS balance
    FROM accounts a
    JOIN account_types at USING (account_type_id)
    JOIN account_type_categories atc USING (account_type_category_id)
    LEFT JOIN v_account_balances_current v USING (account_id)
    ORDER BY atc.account_type_category, at.account_type, a.account_name
  `);

  return (
    result.rows as {
      account_id: number;
      account_name: string;
      account_type_id: number;
      account_type: string;
      account_type_category: string;
      account_identifier: string | null;
      opened_date: string | null;
      closed_date: string | null;
      balance: string;
    }[]
  ).map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    accountTypeId: row.account_type_id,
    accountType: row.account_type,
    accountTypeCategory: row.account_type_category,
    accountIdentifier: row.account_identifier,
    openedDate: row.opened_date,
    closedDate: row.closed_date,
    balance: parseFloat(row.balance) || 0,
  }));
}

export async function accountHasTransactions(
  accountId: number
): Promise<boolean> {
  const result = await db
    .select({ id: transactions.transactionId })
    .from(transactions)
    .where(
      or(
        eq(transactions.accountId, accountId),
        eq(transactions.relatedAccountId, accountId)
      )
    )
    .limit(1);

  return result.length > 0;
}
