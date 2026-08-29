import { join } from "node:path";

/**
 * Everything the E2E run agrees on: setup creates the user, the spec drives the
 * UI, teardown deletes the rows. They must not disagree about names or amounts,
 * so all three read them from here.
 */

// Credentials are test-only by construction: global-setup refuses to run
// against anything but Finances_Test (tests/support/assert-test-database.ts),
// and global-teardown deletes the user again. Overridable so a CI job can pass
// its own without editing source.
export const E2E_USERNAME = process.env.E2E_USERNAME ?? "e2e-test-user";
export const E2E_PASSWORD =
  process.env.E2E_PASSWORD ?? "e2e-only-test-password";

// Teardown deletes accounts by this prefix, so every account the suite creates
// must carry it. The timestamp keeps a re-run from colliding with rows a
// crashed run left behind before teardown could clear them.
export const E2E_ACCOUNT_PREFIX = "E2E Money Path";
export const E2E_ACCOUNT_NAME = `${E2E_ACCOUNT_PREFIX} ${Date.now()}`;

// Seeded by init-db/seeds/finances-test-mock-data.sql. "Checking Account" is
// account_type 2, in account_type_category 1 (Current Asset) — deliberately not
// a Restricted Asset (category 2), which getCurrentNetWorth() and
// getNetWorthTimeSeries() exclude from Net Worth. A restricted type would make
// the KPI delta zero and the assertion vacuous.
//
// The " (Current Asset)" suffix is not decoration: getAccountTypes() builds
// each option's label as `${type} (${category})`, so this string is the option
// as rendered. The transaction form's three lists are plain names by contrast —
// getTransactionFormOptions() selects the columns unchanged.
export const ACCOUNT_TYPE = "Checking Account (Current Asset)";
export const TRANSACTION_TYPE = "Expense";
export const TRANSACTION_CATEGORY = "Other";

// Odd, specific amounts: a rounding or sign regression shows up as a wrong
// number rather than as a coincidence.
export const INITIAL_BALANCE = 1234.56;
export const TRANSACTION_AMOUNT = -321.45;

export const STORAGE_STATE = join(__dirname, "..", ".auth", "state.json");
