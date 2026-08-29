/**
 * The one guard standing between a destructive suite and the real database.
 *
 * Both suites that write rows assert this before doing anything else: the
 * integration project (tests/integration/setup.ts) and the Playwright E2E
 * project (e2e/global-setup.ts, Issue #141). It lives here rather than in
 * either of them because the two would otherwise carry a copy each, and a
 * guard that exists twice is a guard that can be tightened once.
 *
 * The match is deliberately loose — a substring, case-insensitively, in either
 * spelling — because the connection strings in play differ by host, port and
 * role (localhost:5433 for local dev, localhost:5432 for the CI service
 * container, postgres:5432 from inside the network). The database *name* is
 * the only stable part, and it is the part that matters.
 */
export function assertTestDatabaseUrl(url: string | undefined, suite: string): void {
  const value = url ?? "";
  const lower = value.toLowerCase();

  if (!lower.includes("finances_test") && !lower.includes("finances-test")) {
    throw new Error(
      `${suite} require DATABASE_URL to point to the test database.\n` +
        `Current DATABASE_URL: ${value || "(not set)"}\n` +
        `Expected it to contain "Finances_Test". ` +
        `Copy app/.env.local.example to app/.env.local and ensure DATABASE_URL ends with /Finances_Test.`
    );
  }
}
