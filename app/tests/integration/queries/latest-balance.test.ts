import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { accounts, accountBalanceHistory } from "@/drizzle/schema";
import { inArray, sql, type SQL } from "drizzle-orm";
import { balanceRowPerAccount } from "@/lib/queries/_aggregates";
import { getAccountBalances, getAccountsList } from "@/lib/queries/accounts";
import { getAssetAllocation, getLiquidityBreakdown } from "@/lib/queries/assets-drilldown";
import { getLiabilityAllocation } from "@/lib/queries/liabilities-drilldown";

/**
 * The "latest balance per account" path (Issue #126): every query that, given
 * no `dateTo`, reads each account's newest account_balance_history row.
 *
 * Those queries used to pick that row with a correlated
 * `balance_date = (SELECT MAX(balance_date) … WHERE account_id = abh.account_id)`,
 * which Postgres evaluates once per history row. They now join one row per
 * account through balanceRowPerAccount() (a LATERAL probe), and
 * v_account_balances_current has the same shape (migration 0009). The rewrite
 * was meant to move no numbers, so two kinds of test:
 *
 *   - Oracles. The old correlated SQL is kept here, and only here, and the new
 *     shape must return exactly its rows across the whole database (the seed
 *     plus the fixtures below).
 *   - Deltas. Each query function's default path, read before and after the
 *     fixtures are added, must move by exactly the fixtures' latest balances.
 *     Asserting deltas rather than totals keeps them independent of the mock
 *     seed's own accounts.
 *
 * The drilldown test files cover these same functions with an explicit
 * `dateTo`, deliberately outside the seed range. None of them reached the
 * default path, which is the one the dashboard uses.
 */

// Account-type IDs from init-db/seeds/finances-test-mock-data.sql.
const TYPE_REAL_ESTATE = 10; // Fixed Asset, illiquid
const TYPE_CREDIT_CARD = 15; // Current Liability

// UTC dates, matching the database's CURRENT_DATE (the container runs in UTC),
// as tests/integration/queries/rebuild-balance.test.ts does.
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const createdAccountIds: number[] = [];

async function createAccount(
  name: string,
  accountTypeId: number,
  closedDate: string | null = null
): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId, closedDate })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

async function insertBalance(accountId: number, balanceDate: string, cumulativeBalance: string) {
  await db.insert(accountBalanceHistory).values({
    accountId,
    balanceDate,
    dailyBalance: "0.00",
    cumulativeBalance,
  });
}

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    await db
      .delete(accountBalanceHistory)
      .where(inArray(accountBalanceHistory.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
    createdAccountIds.length = 0;
  }
});

// Unique per run, so a leftover from a crashed run cannot be mistaken for
// this run's rows.
const RUN = Date.now();
const NAMES = {
  multiRow: `Latest Multi-row ${RUN}`,
  closedAsset: `Latest Closed Asset ${RUN}`,
  noHistory: `Latest No History ${RUN}`,
  card: `Latest Card ${RUN}`,
  closedCard: `Latest Closed Card ${RUN}`,
};

/**
 * The shapes that broke the correlated form's assumptions, or could break a
 * rewrite's:
 *
 *   - multiRow: an older row as well as its latest, and a latest row that is
 *     not today, so "latest" must mean that account's own latest.
 *   - closedAsset / closedCard: closed, with the last row before the closure,
 *     which is how rebuildAccountBalance leaves a closed account.
 *   - noHistory: no rows at all. It must be absent from inner-joined queries
 *     and zero in /accounts.
 *   - card: a liability with two rows.
 */
async function insertFixtures() {
  const ids = {
    multiRow: await createAccount(NAMES.multiRow, TYPE_REAL_ESTATE),
    closedAsset: await createAccount(NAMES.closedAsset, TYPE_REAL_ESTATE, daysAgo(5)),
    noHistory: await createAccount(NAMES.noHistory, TYPE_REAL_ESTATE),
    card: await createAccount(NAMES.card, TYPE_CREDIT_CARD),
    closedCard: await createAccount(NAMES.closedCard, TYPE_CREDIT_CARD, daysAgo(5)),
  };
  await insertBalance(ids.multiRow, daysAgo(10), "100.00");
  await insertBalance(ids.multiRow, daysAgo(2), "250.00");
  await insertBalance(ids.closedAsset, daysAgo(6), "70.00");
  await insertBalance(ids.card, daysAgo(3), "-40.00");
  await insertBalance(ids.card, daysAgo(1), "-55.00");
  await insertBalance(ids.closedCard, daysAgo(6), "-30.00");
  return ids;
}

async function rows(query: SQL) {
  return (await db.execute(query)).rows;
}

// ────────────────────────────────────────────────────────────────────
// Oracles: new shape vs the correlated form it replaced
// ────────────────────────────────────────────────────────────────────

describe("balanceRowPerAccount oracle", () => {
  beforeEach(insertFixtures);

  it("picks the same latest row per account as the correlated MAX()", async () => {
    const actual = await rows(sql`
      SELECT a.account_id, abh.balance_date::text AS balance_date, abh.cumulative_balance
      FROM accounts a
      ${balanceRowPerAccount()}
      ORDER BY a.account_id
    `);
    const expected = await rows(sql`
      SELECT abh.account_id, abh.balance_date::text AS balance_date, abh.cumulative_balance
      FROM account_balance_history abh
      WHERE abh.balance_date = (
        SELECT MAX(balance_date) FROM account_balance_history
        WHERE account_id = abh.account_id
      )
      ORDER BY abh.account_id
    `);
    expect(actual.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it("picks the same rows as an equality filter when given a date", async () => {
    const date = daysAgo(2);
    const actual = await rows(sql`
      SELECT a.account_id, abh.cumulative_balance
      FROM accounts a
      ${balanceRowPerAccount(date)}
      ORDER BY a.account_id
    `);
    const expected = await rows(sql`
      SELECT abh.account_id, abh.cumulative_balance
      FROM account_balance_history abh
      WHERE abh.balance_date = ${date}::date
      ORDER BY abh.account_id
    `);
    expect(actual.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });
});

describe("v_account_balances_current oracle", () => {
  beforeEach(insertFixtures);

  it("returns exactly the rows of its original correlated definition", async () => {
    // The body of the view as 0000_baseline.sql created it.
    const expected = await rows(sql`
      SELECT abh.account_id, a.account_name, at.account_type,
             atc.account_type_category, atc.account_type_category_id,
             abh.cumulative_balance AS current_balance, abh.balance_date::text AS balance_date
      FROM account_balance_history abh
      JOIN accounts a USING (account_id)
      JOIN account_types at USING (account_type_id)
      JOIN account_type_categories atc USING (account_type_category_id)
      WHERE abh.balance_date = (
        SELECT MAX(balance_date) FROM account_balance_history
        WHERE account_id = abh.account_id
      )
      ORDER BY abh.account_id
    `);
    const actual = await rows(sql`
      SELECT account_id, account_name, account_type, account_type_category,
             account_type_category_id, current_balance, balance_date::text AS balance_date
      FROM v_account_balances_current
      ORDER BY account_id
    `);
    expect(actual.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });
});

// ────────────────────────────────────────────────────────────────────
// Deltas: each default path moves by exactly the fixtures' latest rows
// ────────────────────────────────────────────────────────────────────

const typeValue = (
  data: { byCategory: { children: { accountTypeId: number; value: number }[] }[] },
  typeId: number
) =>
  data.byCategory
    .flatMap((c) => c.children)
    .filter((t) => t.accountTypeId === typeId)
    .reduce((s, t) => s + t.value, 0);

describe("default path (latest row per account)", () => {
  it("getAccountBalances: open accounts at their latest row, closed and empty ones absent", async () => {
    await insertFixtures();
    const leaves = (await getAccountBalances()).filter((r) => r.accountName !== null);
    const leaf = (name: string) => leaves.filter((r) => r.accountName === name);

    expect(leaf(NAMES.multiRow).map((r) => r.balance)).toEqual([250]);
    expect(leaf(NAMES.card).map((r) => r.balance)).toEqual([-55]);
    expect(leaf(NAMES.closedAsset)).toEqual([]);
    expect(leaf(NAMES.closedCard)).toEqual([]);
    expect(leaf(NAMES.noHistory)).toEqual([]);
  });

  it("getAccountsList: every account, at its latest row through the view, 0 with no history", async () => {
    await insertFixtures();
    const list = await getAccountsList();
    const balanceOf = (name: string) => list.find((r) => r.accountName === name)?.balance;

    expect(balanceOf(NAMES.multiRow)).toBe(250);
    expect(balanceOf(NAMES.closedAsset)).toBe(70);
    expect(balanceOf(NAMES.noHistory)).toBe(0);
    expect(balanceOf(NAMES.card)).toBe(-55);
  });

  it("getAssetAllocation: the account type moves by the latest row, not the earlier one", async () => {
    const before = typeValue(await getAssetAllocation(), TYPE_REAL_ESTATE);
    await insertFixtures();
    const after = typeValue(await getAssetAllocation(), TYPE_REAL_ESTATE);

    // multiRow's latest (250), not its older 100. closedAsset's last row (70)
    // still counts: the asset allocation has never filtered closed accounts,
    // and this rewrite was not meant to change that. noHistory adds nothing.
    expect(after - before).toBeCloseTo(250 + 70, 2);
  });

  it("getLiquidityBreakdown: the type's default bucket moves by the latest rows", async () => {
    const illiquid = async () =>
      (await getLiquidityBreakdown()).classes.find((c) => c.liquidityClass === "illiquid")
        ?.value ?? 0;
    const before = await illiquid();
    await insertFixtures();
    expect((await illiquid()) - before).toBeCloseTo(250 + 70, 2);
  });

  it("getLiabilityAllocation: latest row of open liabilities; closed ones excluded", async () => {
    const before = typeValue(await getLiabilityAllocation(), TYPE_CREDIT_CARD);
    await insertFixtures();
    const after = typeValue(await getLiabilityAllocation(), TYPE_CREDIT_CARD);

    // card's latest (-55), not -40. closedCard is closed before today.
    expect(after - before).toBeCloseTo(-55, 2);
  });
});
