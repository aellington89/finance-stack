import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import { assertTestDatabaseUrl } from "../tests/support/assert-test-database";
import { cleanupE2eRows, deleteE2eUser, withClient } from "./fixtures/db";

/**
 * Leaves Finances_Test as the suite found it: the accounts, transactions and
 * balance history the run created, and the user it signed in as, are all
 * deleted.
 *
 * CI's database is thrown away with the job, so this is for the developer's
 * local Finances_Test — which is the same database the integration project and
 * a `npm run dev` session read.
 */
export default async function globalTeardown() {
  loadEnv({ path: resolve(__dirname, "..", ".env.local") });
  assertTestDatabaseUrl(process.env.DATABASE_URL, "E2E tests");

  await withClient(async (client) => {
    await cleanupE2eRows(client);
    await deleteE2eUser(client);
  });
}
