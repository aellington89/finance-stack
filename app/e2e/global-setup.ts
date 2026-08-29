import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import { hashPassword } from "../lib/auth/password";
import { assertTestDatabaseUrl } from "../tests/support/assert-test-database";
import { E2E_PASSWORD, E2E_USERNAME } from "./fixtures/constants";
import { cleanupE2eRows, withClient } from "./fixtures/db";

/**
 * Runs once, before the browser and before the app server is asked for a page.
 *
 * Two jobs, in this order:
 *
 *   1. Refuse to run against anything but Finances_Test. This suite creates and
 *      deletes rows through the real UI, so the guard matters more here than it
 *      does for the integration project.
 *   2. Create the user the `setup` project signs in as. There is no public
 *      registration (docs/auth.md), so the account has to exist before the
 *      first navigation — and it is created with the same scrypt hashing
 *      scripts/create-user.ts uses, rather than a fixture hash, so the sign-in
 *      the spec performs exercises the real credential path.
 */
export default async function globalSetup() {
  loadEnv({ path: resolve(__dirname, "..", ".env.local") });
  assertTestDatabaseUrl(process.env.DATABASE_URL, "E2E tests");

  const passwordHash = await hashPassword(E2E_PASSWORD);

  await withClient(async (client) => {
    // Upsert, like scripts/create-user.ts: a re-run must reset the password
    // rather than fail on the unique username.
    await client.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role`,
      [E2E_USERNAME, passwordHash]
    );

    await cleanupE2eRows(client);
  });
}
