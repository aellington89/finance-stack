import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Cadence } from "@/lib/recurring/schedule";

/** One recurring-transaction template as the Recurring tab lists it (Issue #135). */
export interface RecurringTransactionRow {
  recurringTransactionId: number;
  transactionDescription: string;
  /** As stored, e.g. "-1450.00": what the edit dialog prefills. */
  amount: string;
  accountId: number;
  accountName: string;
  /** The account's close date; a closed account's template can't run. */
  accountClosedDate: string | null;
  relatedAccountId: number | null;
  relatedAccountName: string | null;
  transactionTypeId: number;
  transactionType: string;
  transactionCategoryId: number;
  transactionCategory: string;
  cadence: Cadence;
  intervalCount: number;
  anchorDate: string;
  nextRunDate: string;
  endDate: string | null;
  isActive: boolean;
}

interface Row {
  [key: string]: unknown;
  recurring_transaction_id: number;
  transaction_description: string;
  amount: string;
  account_id: number;
  account_name: string;
  account_closed_date: string | null;
  related_account_id: number | null;
  related_account_name: string | null;
  transaction_type_id: number;
  transaction_type: string;
  transaction_category_id: number;
  transaction_category: string;
  cadence: Cadence;
  interval_count: number;
  anchor_date: string;
  next_run_date: string;
  end_date: string | null;
  is_active: boolean;
}

/**
 * Every template, each group by next date: first the ones that still run (active
 * and not past their end date), then the Ended and paused ones. An Ended
 * template keeps is_active = true, so the flag alone would list it among the
 * running ones. "Ended" is the test recurringStatus() makes.
 */
export async function getRecurringTransactions(): Promise<RecurringTransactionRow[]> {
  const result = await db.execute<Row>(sql`
    SELECT r.recurring_transaction_id,
           r.transaction_description,
           r.amount::text AS amount,
           r.account_id,
           a.account_name,
           a.closed_date::text AS account_closed_date,
           r.related_account_id,
           ra.account_name AS related_account_name,
           r.transaction_type_id,
           tt.transaction_type,
           r.transaction_category_id,
           tc.transaction_category,
           r.cadence,
           r.interval_count,
           r.anchor_date::text AS anchor_date,
           r.next_run_date::text AS next_run_date,
           r.end_date::text AS end_date,
           r.is_active
    FROM recurring_transactions r
    JOIN accounts a ON a.account_id = r.account_id
    LEFT JOIN accounts ra ON ra.account_id = r.related_account_id
    JOIN transaction_types tt ON tt.transaction_type_id = r.transaction_type_id
    JOIN transaction_categories tc ON tc.transaction_category_id = r.transaction_category_id
    ORDER BY (r.is_active AND (r.end_date IS NULL OR r.next_run_date <= r.end_date)) DESC,
             r.next_run_date,
             r.recurring_transaction_id
  `);

  return result.rows.map((r) => ({
    recurringTransactionId: r.recurring_transaction_id,
    transactionDescription: r.transaction_description,
    amount: r.amount,
    accountId: r.account_id,
    accountName: r.account_name,
    accountClosedDate: r.account_closed_date,
    relatedAccountId: r.related_account_id,
    relatedAccountName: r.related_account_name,
    transactionTypeId: r.transaction_type_id,
    transactionType: r.transaction_type,
    transactionCategoryId: r.transaction_category_id,
    transactionCategory: r.transaction_category,
    cadence: r.cadence,
    intervalCount: r.interval_count,
    anchorDate: r.anchor_date,
    nextRunDate: r.next_run_date,
    endDate: r.end_date,
    isActive: r.is_active,
  }));
}
