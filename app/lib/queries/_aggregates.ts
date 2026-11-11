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
 * The categories carrying any of `roles`, as a subquery for an `IN (…)`:
 *
 *   sql`t.transaction_category_id IN (${categoryIdsWithRoles(DEBT_PAYMENT_ROLES)})`
 *
 * This is what replaced the hard-coded id lists the Liabilities drilldown used
 * to filter on (issue #111). Resolving membership in the database rather than
 * in TypeScript is the point: the set is whatever the user has tagged at query
 * time, so a category they add and tag today is counted today, with no code
 * change and no second round trip to fetch ids first.
 *
 * Every role is bound as a parameter, so this composes under the `sql.raw` ban
 * the same way `valueList` does (see docs/input-validation.md).
 */
export function categoryIdsWithRoles(roles: readonly string[]): SQL {
  return sql`
    SELECT transaction_category_id FROM transaction_categories
    WHERE reporting_role IN (${valueList(roles)})
  `;
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

/**
 * Pattern C — join exactly one balance row per account, as `abh`:
 *
 *   FROM accounts a
 *   JOIN account_types at …
 *   ${balanceRowPerAccount(dateTo)}
 *
 * With `dateTo`, the account's row on that date. An account with no row that
 * day (not yet opened, or already closed) contributes nothing. This is the same
 * rows as the `abh.balance_date = dateTo` filter it replaced.
 *
 * Without it, the account's latest row, found with one probe of
 * `idx_abh_account_date (account_id, balance_date DESC)` per account. The form
 * it replaced (Issue #126) was
 *
 *   WHERE abh.balance_date = (SELECT MAX(balance_date) FROM account_balance_history
 *                             WHERE account_id = abh.account_id)
 *
 * It returned the same rows, but Postgres evaluates that subquery once per
 * history row rather than once per account. Its cost therefore grew with
 * history, by about one row per open account per day, and on a production-sized
 * dataset it was ~25–72 ms per query, against ~0.1 ms for this. Pick a "latest
 * row" with this rather than reintroducing the correlated MAX.
 * `v_account_balances_current` has the same shape, in SQL
 * (migration 0009).
 *
 * Exposes `abh.balance_date` and `abh.cumulative_balance`. Assumes the
 * `accounts` table is aliased `a` in the surrounding query.
 */
export function balanceRowPerAccount(dateTo?: string): SQL {
  if (dateTo) {
    return sql`
      JOIN account_balance_history abh
        ON abh.account_id = a.account_id
       AND abh.balance_date = ${dateTo}::date
    `;
  }
  return sql`
    JOIN LATERAL (
      SELECT h.balance_date, h.cumulative_balance
      FROM account_balance_history h
      WHERE h.account_id = a.account_id
      ORDER BY h.balance_date DESC
      LIMIT 1
    ) abh ON true
  `;
}

/**
 * Pattern D — is a balance-transfer promo active on `date`? (Issue #417)
 *
 *   (p.amount < 0 AND p.transaction_date <= D AND D < bt.promo_end_date)
 *
 * A promo is active on the half-open interval [posting date, promo_end_date):
 * the posting's own day counts, and the end day does not. This is the one
 * place that rule is written down in SQL. Every query that asks "is this card
 * promotional on D" composes it, directly or through accountHasActivePromo(),
 * so the answer cannot drift between the tracker card, the debt-mix split and
 * the performance badge.
 *
 * `p.amount < 0` belongs to the same question. The action only links a
 * posting that added debt, and a posting later edited into a credit drops out
 * here, the same way one moved to an asset account drops out of the
 * liability-filtered queries around it, rather than being reported as a
 * transfer.
 *
 * `date` is `string | SQL`, as for balanceAtDate(): a `YYYY-MM-DD` string or an
 * expression such as sql`CURRENT_DATE`.
 *
 * Assumes `balance_transfers` aliased `bt`, joined to its posting in
 * `transactions` aliased `p`.
 */
export function promoActiveOn(date: string | SQL): SQL {
  return sql`(p.amount < 0 AND p.transaction_date <= ${date}::date AND ${date}::date < bt.promo_end_date)`;
}

/**
 * Pattern E — does account `a` carry an active balance-transfer promo on
 * `date`? (Issue #417)
 *
 *   EXISTS (SELECT 1 FROM balance_transfers bt
 *           JOIN transactions p ON p.transaction_id = bt.transfer_transaction_id
 *           WHERE p.account_id = a.account_id AND <promoActiveOn(date)>)
 *
 * The card is whichever account the posting is on now, so editing the
 * posting's account moves the promo with it. balance_transfers is small and
 * both of its links are UNIQUE-indexed, so this is a cheap probe per account.
 *
 * Assumes the `accounts` table is aliased `a` in the surrounding query. The
 * subquery's own `bt` and `p` shadow any outer aliases of the same name.
 */
export function accountHasActivePromo(date: string | SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM balance_transfers bt
    JOIN transactions p ON p.transaction_id = bt.transfer_transaction_id
    WHERE p.account_id = a.account_id
      AND ${promoActiveOn(date)}
  )`;
}
