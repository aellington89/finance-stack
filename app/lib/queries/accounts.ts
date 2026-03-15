import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface AccountBalanceRow {
  accountTypeCategory: string | null;
  accountType: string | null;
  accountName: string | null;
  balance: number;
}

export async function getAccountBalances(): Promise<AccountBalanceRow[]> {
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
