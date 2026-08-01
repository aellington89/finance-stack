import { sql, type SQL } from "drizzle-orm";

/**
 * Shared SQL fragments for the query layer.
 *
 * These return Drizzle `SQL` fragments (a single `SELECT` column each) so the
 * repeated `SUM(CASE WHEN …)` blocks live in one place and their null/rounding
 * handling stays consistent. They do NOT touch the database.
 *
 * Aliases go through `sql.identifier`, which quotes and escapes them, rather
 * than `sql.raw` (Issue #179). They are static internal identifiers either way,
 * so this is not a fix for a live hole — it is what lets the `sql.raw` ban in
 * eslint.config.mjs be absolute instead of a rule with exceptions.
 */

/**
 * The body of an `IN (…)` list, as one bound placeholder per value:
 *
 *   sql`t.account_id IN (${valueList(accountIds)})`   ->   IN ($1, $2, $3)
 *
 * The query modules use raw `sql` templates with a `t` alias rather than the
 * Drizzle query builder, so `inArray()` is not available to them — it emits the
 * fully-qualified `"transactions"."account_id"`, which does not resolve against
 * the alias. This is the parameterized stand-in, and the reason none of those
 * modules needs to reach for `sql.raw` to build a list (Issue #179).
 */
export function valueList(values: readonly (string | number)[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  );
}

/**
 * Pattern A — sum a transaction amount for a single transaction type:
 *
 *   SUM(CASE WHEN t.transaction_type_id = <typeId> [AND <predicate>]
 *            THEN ABS(t.amount) ELSE 0 END) AS <alias>
 *
 * The optional `predicate` adds extra CASE conditions (e.g. the date-window
 * arms of the to-date comparison query).
 *
 * Assumes the `transactions` table is aliased `t` in the surrounding query.
 */
export function sumAmountByType(
  typeId: number,
  alias: string,
  predicate?: SQL
): SQL {
  const guard = predicate ? sql` AND ${predicate}` : sql``;
  return sql`SUM(CASE WHEN t.transaction_type_id = ${typeId}${guard} THEN ABS(t.amount) ELSE 0 END) AS ${sql.identifier(alias)}`;
}

/**
 * Pattern B — cumulative account balance snapshot on a specific date:
 *
 *   COALESCE(SUM(CASE WHEN abh.balance_date = <date>::date
 *            THEN abh.cumulative_balance ELSE 0 END), 0) AS <alias>
 *
 * `date` is `string | SQL`: a `YYYY-MM-DD` string, or a SQL expression such as
 * sql`CURRENT_DATE` (used when the caller's `dateTo` is omitted).
 *
 * Assumes the `account_balance_history` table is aliased `abh` in the
 * surrounding query.
 */
export function balanceAtDate(date: string | SQL, alias: string): SQL {
  return sql`COALESCE(SUM(CASE WHEN abh.balance_date = ${date}::date THEN abh.cumulative_balance ELSE 0 END), 0) AS ${sql.identifier(alias)}`;
}
