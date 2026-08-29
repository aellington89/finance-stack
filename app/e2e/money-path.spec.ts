import { test, expect, type Page } from "@playwright/test";

import {
  ACCOUNT_TYPE,
  E2E_ACCOUNT_NAME,
  INITIAL_BALANCE,
  TRANSACTION_AMOUNT,
  TRANSACTION_CATEGORY,
  TRANSACTION_TYPE,
} from "./fixtures/constants";

/**
 * The core money path, end to end (Issue #141).
 *
 * Everything this touches is already unit- or integration-tested in isolation:
 * tests/integration/actions/transaction.test.ts calls submitTransaction() with
 * a hand-built FormData and a mocked session, and
 * tests/integration/queries/rebuild-balance.test.ts checks the SQL. What none
 * of them can fail on is the *wiring* — a renamed form field, a page that
 * stopped revalidating, a proxy redirect, a KPI reading the wrong point of the
 * series. That is this spec's whole job, which is why it drives the browser
 * and asserts only on what a person can see.
 *
 * One path, deliberately. The issue's out-of-scope note asks for one critical
 * happy path rather than coverage, and a suite of two is where an E2E suite
 * starts costing more than it catches.
 */

const TRANSACTION_DESCRIPTION = "E2E Money Path expense";

/**
 * "$1,234.56" / "-$321.45" → a number. Never string-compare these: the page
 * renders Intl.NumberFormat output, so a grouping separator or a locale
 * difference would fail an assertion that money arithmetic passed.
 */
function parseCurrency(text: string): number {
  const cleaned = text.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  expect(cleaned, `could not parse a currency value from "${text}"`).not.toBe("");
  expect(Number.isNaN(value), `could not parse a currency value from "${text}"`).toBe(false);
  return value;
}

/** The same formatter the pages use, so an expectation cannot drift from them. */
function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

async function readNetWorth(page: Page): Promise<number> {
  await page.goto("/dashboard");
  const headline = page.getByTestId("kpi-net-worth");
  await expect(headline).toBeVisible();
  return parseCurrency(await headline.innerText());
}

/**
 * The comboboxes are @base-ui/react (components/ui/combobox.tsx): a text input
 * that filters, and a listbox rendered through a Portal — so the option is a
 * page-level locator, not one scoped inside the <form>.
 */
async function selectComboboxOption(page: Page, label: string, option: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.click();
  await input.fill(option);
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(input).toHaveValue(option);
}

test("account → transaction → balance rebuild → dashboard KPI", async ({ page }) => {
  let baseline = 0;

  await test.step("read the Net Worth baseline", async () => {
    baseline = await readNetWorth(page);
  });

  await test.step("create an account with an opening balance", async () => {
    await page.goto("/accounts/new");

    await page.getByLabel("Account Name *", { exact: true }).fill(E2E_ACCOUNT_NAME);
    await selectComboboxOption(page, "Account Type *", ACCOUNT_TYPE);

    // Opened Date is left blank on purpose: createAccount then dates the
    // opening-balance transaction today, which is what puts a balance row at
    // CURRENT_DATE — the point the dashboard's series ends on.
    await page.getByLabel("Initial Balance", { exact: true }).fill(String(INITIAL_BALANCE));

    await page.getByRole("button", { name: "Create Account" }).click();

    // createAccount's client pushes to /accounts on success.
    await page.waitForURL("**/accounts");
    await expect(page.getByRole("link", { name: E2E_ACCOUNT_NAME, exact: true })).toBeVisible();
  });

  await test.step("the opening balance reaches the KPI", async () => {
    expect(await readNetWorth(page)).toBeCloseTo(baseline + INITIAL_BALANCE, 2);
  });

  await test.step("post a transaction against the account", async () => {
    await page.goto("/dashboard/transactions");

    await page
      .getByLabel("Description *", { exact: true })
      .fill(TRANSACTION_DESCRIPTION);
    await page.getByLabel("Amount *", { exact: true }).fill(String(TRANSACTION_AMOUNT));
    await selectComboboxOption(page, "Account *", E2E_ACCOUNT_NAME);
    await selectComboboxOption(page, "Transaction Type *", TRANSACTION_TYPE);
    await selectComboboxOption(page, "Category *", TRANSACTION_CATEGORY);

    await page.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByText("Transaction created successfully")).toBeVisible();
  });

  await test.step("the rebuild reaches the account's own balance", async () => {
    await page.goto("/accounts");

    // The leaf row is: <div><div><Link>name</Link></div><div>…balance</div></div>
    const row = page
      .getByRole("link", { name: E2E_ACCOUNT_NAME, exact: true })
      .locator("xpath=../..");

    await expect(row).toContainText(
      formatUsd(INITIAL_BALANCE + TRANSACTION_AMOUNT)
    );
  });

  await test.step("the transaction reaches the KPI", async () => {
    expect(await readNetWorth(page)).toBeCloseTo(
      baseline + INITIAL_BALANCE + TRANSACTION_AMOUNT,
      2
    );
  });
});
