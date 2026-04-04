import { config } from "dotenv";
import { resolve } from "path";

/**
 * Global setup for integration tests.
 * Asserts that DATABASE_URL points to the test database before any tests run,
 * preventing accidental execution against the production database.
 */
export default function setup() {
  config({ path: resolve(process.cwd(), ".env.local") });
  const url = process.env.DATABASE_URL ?? "";
  const lowerUrl = url.toLowerCase();

  if (!lowerUrl.includes("finances_test") && !lowerUrl.includes("finances-test")) {
    throw new Error(
      `Integration tests require DATABASE_URL to point to the test database.\n` +
        `Current DATABASE_URL: ${url || "(not set)"}\n` +
        `Expected it to contain "Finances_Test". ` +
        `Copy app/.env.local.example to app/.env.local and ensure DATABASE_URL ends with /Finances_Test.`
    );
  }
}
