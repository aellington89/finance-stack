import { config } from "dotenv";
import { resolve } from "path";
import { assertTestDatabaseUrl } from "../support/assert-test-database";

/**
 * Global setup for integration tests.
 * Asserts that DATABASE_URL points to the test database before any tests run,
 * preventing accidental execution against the production database.
 *
 * The assertion itself lives in tests/support/ because the Playwright E2E
 * suite makes the same one (Issue #141).
 */
export default function setup() {
  config({ path: resolve(process.cwd(), ".env.local") });
  assertTestDatabaseUrl(process.env.DATABASE_URL, "Integration tests");
}
