import { test, expect, type Page } from "@playwright/test";

import { E2E_ACCOUNT_PREFIX } from "./fixtures/constants";
import { parseCurrency } from "./fixtures/currency";
import { withClient } from "./fixtures/db";

/**
 * Today's carry-forward reaches a page reached by soft navigation (Issue #408).
 *
 * Every figure a dashboard page computes "as of today" reads
 * `account_balance_history` at `balance_date = CURRENT_DATE`. Those rows exist
 * only once ensureTodayBalances() has carried each open account forward, and
 * the dashboard layout's call to it is not enough: a soft navigation between
 * tabs re-renders only the page segment, so the layout is not rendered at all.
 * A tab left open across midnight would then read a day with no rows for the
 * accounts that saw no transaction, and show their balances as $0.
 *
 * Nothing below the browser can fail on this. Whether the layout renders is the
 * App Router's decision, made on the client's router state, and the
 * integration tests call the query functions directly. Hence a second spec
 * beside the money path.
 *
 * The date cannot be rolled over from here, so the spec does the equivalent:
 * it deletes one account's row for today, leaving yesterday's as its latest.
 * That is exactly the state every account is in for the first moment of a new
 * day. Before the fix this failed every time, by exactly that account's
 * balance.
 */

// Teardown deletes accounts by prefix (fixtures/db.ts), so this one is
// cleaned up with the money path's.
const ACCOUNT_NAME = `${E2E_ACCOUNT_PREFIX} carry-forward ${Date.now()}`;

// Odd and specific, for the same reason as the money path's amounts: a missing
// row shows up as this exact shortfall rather than as a coincidence.
const CARRIED_BALANCE = 4321.09;

async function readKpi(page: Page): Promise<number> {
  const headline = page.getByTestId("kpi-net-worth");
  await expect(headline).toBeVisible();
  return parseCurrency(await headline.innerText());
}

/**
 * A tab click is router.push(), a soft navigation. Asserting the marker set
 * after the last hard load is still there is what proves no full reload
 * happened. A full reload would render the layout and pass the spec without
 * exercising the page's own carry-forward.
 */
async function softNavigate(page: Page, tab: string, path: string) {
  // Retried because a click that lands before the tabs hydrate does nothing.
  await expect(async () => {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.waitForURL((url) => url.pathname === path, { timeout: 2_000 });
  }).toPass();
  expect(
    await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
    `navigating to ${path} reloaded the page instead of a soft navigation`
  ).toBe(true);
}

test("a soft navigation after the day rolls over still counts every account", async ({ page }) => {
  let accountId = 0;

  await test.step("an open account whose latest balance row is yesterday's", async () => {
    accountId = await withClient(async (client) => {
      // Looked up by name rather than by id: "Checking Account" is a Current
      // Asset, so it counts toward Net Worth (see fixtures/constants.ts).
      const { rows } = await client.query<{ account_id: number }>(
        `INSERT INTO accounts (account_name, account_type_id)
         SELECT $1, account_type_id FROM account_types
         WHERE account_type = 'Checking Account'
         RETURNING account_id`,
        [ACCOUNT_NAME]
      );
      expect(rows, "seeded account type 'Checking Account' not found").toHaveLength(1);
      await client.query(
        `INSERT INTO account_balance_history
           (account_id, balance_date, daily_balance, cumulative_balance)
         VALUES ($1, CURRENT_DATE - 1, 0, $2)`,
        [rows[0].account_id, CARRIED_BALANCE]
      );
      return rows[0].account_id;
    });
  });

  let netWorth = 0;

  await test.step("a hard load carries every account forward to today", async () => {
    // A tab that reads no balances, so only the layout's carry-forward runs
    // here. Reading the baseline on a later soft navigation, once that INSERT
    // has long committed, means it includes this account whether or not the
    // fix is in. On the unfixed code a hard load of /dashboard could lose the
    // race itself, and the comparison below would then pass by accident.
    await page.goto("/dashboard/accounting");
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });
    await softNavigate(page, "Summary", "/dashboard");
    netWorth = await readKpi(page);
  });

  await test.step("the day rolls over for that account", async () => {
    const deleted = await withClient((client) =>
      client.query(
        `DELETE FROM account_balance_history
         WHERE account_id = $1 AND balance_date = CURRENT_DATE`,
        [accountId]
      )
    );
    // The hard load above must have written today's row, or this spec is not
    // testing a rollover.
    expect(deleted.rowCount).toBe(1);
  });

  await test.step("tab away and back without a reload", async () => {
    await softNavigate(page, "Personal Accounting", "/dashboard/accounting");
    await expect(page.getByTestId("kpi-net-worth")).toHaveCount(0);
    await softNavigate(page, "Summary", "/dashboard");
  });

  await test.step("Net Worth still includes the account", async () => {
    expect(await readKpi(page)).toBeCloseTo(netWorth, 2);
  });
});
