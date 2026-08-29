import { Client } from "pg";

import { E2E_ACCOUNT_PREFIX, E2E_USERNAME } from "./constants";

/**
 * Direct psql-level access for setup and teardown only — the tests themselves
 * go through the browser.
 *
 * A plain `pg` Client rather than @/lib/db: that module is a pooled singleton
 * built for the running server, and setup/teardown are one-shot scripts in a
 * different process. Nothing here should keep a pool alive after it returns.
 */
export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Removes every row the suite creates, in FK order — the same order and the
 * same reason as the afterEach in tests/integration/actions/transaction.test.ts
 * (transactions, then account_balance_history, then accounts).
 *
 * Runs in teardown *and* in setup: a run killed mid-flight (Ctrl-C, a CI
 * cancellation) never reaches teardown, and the developer's Finances_Test
 * should not accumulate its leftovers.
 *
 * audit_log rows are deliberately left alone. The log has no FK to the rows it
 * describes precisely so it can outlive them, and the integration suite leaves
 * its own audit rows behind for the same reason.
 */
export async function cleanupE2eRows(client: Client): Promise<void> {
  const prefix = `${E2E_ACCOUNT_PREFIX}%`;
  const ids = `SELECT account_id FROM accounts WHERE account_name LIKE $1`;

  await client.query(
    `DELETE FROM transactions WHERE account_id IN (${ids}) OR related_account_id IN (${ids})`,
    [prefix]
  );
  await client.query(
    `DELETE FROM account_balance_history WHERE account_id IN (${ids})`,
    [prefix]
  );
  await client.query(`DELETE FROM accounts WHERE account_name LIKE $1`, [prefix]);
}

export async function deleteE2eUser(client: Client): Promise<void> {
  await client.query(`DELETE FROM users WHERE username = $1`, [E2E_USERNAME]);
}
