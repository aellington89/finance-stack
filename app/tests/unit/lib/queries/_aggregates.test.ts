import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  sumAmountByType,
  balanceAtDate,
  valueList,
  promoActiveOn,
  accountHasActivePromo,
} from "@/lib/queries/_aggregates";

// Render a SQL fragment to its parameterized text + params so we can assert the
// exact generated SQL and guard against accidental drift.
const dialect = new PgDialect();
const render = (frag: ReturnType<typeof sumAmountByType>) =>
  dialect.sqlToQuery(frag);

// Aliases are double-quoted since Issue #179 moved them from sql.raw() to
// sql.identifier(). The emitted column name is unchanged — these are all
// lowercase, and an unquoted identifier folds to lowercase anyway — so callers
// still read row.total_income; only the generated text moved.

describe("sumAmountByType", () => {
  it("builds a typed SUM(CASE) column without a predicate", () => {
    const { sql: text, params } = render(sumAmountByType(4, "total_income"));
    expect(text).toBe(
      'SUM(CASE WHEN t.transaction_type_id = $1 THEN ABS(t.amount) ELSE 0 END) AS "total_income"'
    );
    expect(params).toEqual([4]);
  });

  it("ANDs an extra predicate into the CASE arm", () => {
    const { sql: text, params } = render(
      sumAmountByType(2, "cur_expenses", sql`t.transaction_date >= p.cur_start`)
    );
    expect(text).toBe(
      'SUM(CASE WHEN t.transaction_type_id = $1 AND t.transaction_date >= p.cur_start THEN ABS(t.amount) ELSE 0 END) AS "cur_expenses"'
    );
    expect(params).toEqual([2]);
  });

  it("escapes a quote in an alias rather than emitting it raw", () => {
    // The property sql.raw() did not have. These aliases are internal
    // constants, so this asserts the mechanism, not a reachable input.
    const { sql: text } = render(sumAmountByType(4, 'we"ird'));
    expect(text).toContain('AS "we""ird"');
  });
});

describe("balanceAtDate", () => {
  it("builds a COALESCE'd balance snapshot for a string date", () => {
    const { sql: text, params } = render(
      balanceAtDate("2024-01-01", "start_balance")
    );
    expect(text).toBe(
      'COALESCE(SUM(CASE WHEN abh.balance_date = $1::date THEN abh.cumulative_balance ELSE 0 END), 0) AS "start_balance"'
    );
    expect(params).toEqual(["2024-01-01"]);
  });

  it("inlines a SQL date expression like CURRENT_DATE", () => {
    const { sql: text, params } = render(
      balanceAtDate(sql`CURRENT_DATE`, "end_balance")
    );
    expect(text).toBe(
      'COALESCE(SUM(CASE WHEN abh.balance_date = CURRENT_DATE::date THEN abh.cumulative_balance ELSE 0 END), 0) AS "end_balance"'
    );
    expect(params).toEqual([]);
  });
});

describe("valueList", () => {
  // The replacement for `sql.raw(ids.join(", "))` (Issue #179): one bound
  // placeholder per entry, so an IN (…) list carries no values in its text.
  it("emits one placeholder per value", () => {
    const { sql: text, params } = render(sql`t.account_id IN (${valueList([4, 8, 15])})`);
    expect(text).toBe("t.account_id IN ($1, $2, $3)");
    expect(params).toEqual([4, 8, 15]);
  });

  it("binds strings rather than quoting them into the text", () => {
    const { sql: text, params } = render(
      sql`t.transaction_description IN (${valueList(["Rent", "O'Brien & Co"])})`
    );
    expect(text).toBe("t.transaction_description IN ($1, $2)");
    expect(params).toEqual(["Rent", "O'Brien & Co"]);
  });
});

describe("promoActiveOn", () => {
  // The half-open interval [posting date, promo_end_date) of Issue #417: `<=`
  // on the posting side and a strict `<` on the end side. Pinned as text
  // because flipping either operator moves a boundary day silently; the
  // integration suite proves the same boundaries against real rows.
  it("binds the date and keeps the interval half-open", () => {
    const { sql: text, params } = render(promoActiveOn("2026-03-01"));
    expect(text).toBe(
      "(p.amount < 0 AND p.transaction_date <= $1::date AND $2::date < bt.promo_end_date)"
    );
    expect(params).toEqual(["2026-03-01", "2026-03-01"]);
  });

  it("inlines a SQL date expression like CURRENT_DATE", () => {
    const { sql: text, params } = render(promoActiveOn(sql`CURRENT_DATE`));
    expect(text).toBe(
      "(p.amount < 0 AND p.transaction_date <= CURRENT_DATE::date AND CURRENT_DATE::date < bt.promo_end_date)"
    );
    expect(params).toEqual([]);
  });
});

describe("accountHasActivePromo", () => {
  it("correlates on the outer account alias and reuses promoActiveOn", () => {
    const { sql: text, params } = render(accountHasActivePromo("2026-03-01"));
    const flat = text.replace(/\s+/g, " ").trim();
    expect(flat).toBe(
      "EXISTS ( SELECT 1 FROM balance_transfers bt " +
        "JOIN transactions p ON p.transaction_id = bt.transfer_transaction_id " +
        "WHERE p.account_id = a.account_id " +
        "AND (p.amount < 0 AND p.transaction_date <= $1::date AND $2::date < bt.promo_end_date) )"
    );
    expect(params).toEqual(["2026-03-01", "2026-03-01"]);
  });
});
