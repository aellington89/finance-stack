import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, auditLog } from "@/drizzle/schema";
import { auth } from "@/auth";
import { requireActionUser } from "@/lib/auth/guard";
import { createAccount } from "@/lib/actions/account";
import { __resetAllLimits } from "@/lib/security/rate-limit";

/**
 * The per-user mutation limit (#182). It lives inside requireActionUser(), so
 * it applies to all 18 guarded actions at once — createAccount stands in for
 * the set.
 *
 * The budget is spent by calling the guard directly rather than by running 120
 * real inserts: the guard is the thing under test, and the alternative would
 * add a couple of hundred rows and audit-trigger firings to every test run.
 */

const mockedAuth = auth as unknown as Mock;

/** RATE_LIMITS.action.max */
const MAX_ACTIONS = 120;

const ACCOUNT_NAME = "Rate Limit Test";
const emptyState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.append(key, val);
  }
  return fd;
}

async function spendBudget(times: number): Promise<void> {
  for (let i = 0; i < times; i++) await requireActionUser();
}

beforeEach(() => {
  __resetAllLimits();
});

afterEach(async () => {
  await db.delete(accounts).where(eq(accounts.accountName, ACCOUNT_NAME));
  await db
    .delete(auditLog)
    .where(
      and(
        eq(auditLog.tableName, "accounts"),
        sql`coalesce(${auditLog.afterData}, ${auditLog.beforeData}) ->> 'account_name' = ${ACCOUNT_NAME}`
      )
    );
});

describe("requireActionUser() rate limit", () => {
  it("allows calls up to the ceiling", async () => {
    await spendBudget(MAX_ACTIONS - 1);

    expect(await requireActionUser()).toBeNull();
  });

  it("denies the call after the ceiling", async () => {
    await spendBudget(MAX_ACTIONS);

    const denied = await requireActionUser();
    expect(denied?.success).toBe(false);
    expect(denied?.message).toMatch(/too many requests/i);
  });

  it("budgets each user separately", async () => {
    await spendBudget(MAX_ACTIONS);
    expect(await requireActionUser()).not.toBeNull();

    mockedAuth.mockResolvedValueOnce({
      user: { id: "11111111-1111-1111-1111-111111111111", role: "admin" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    expect(await requireActionUser()).toBeNull();
  });

  it("checks the session first — an unauthenticated call is not merely limited", async () => {
    await spendBudget(MAX_ACTIONS);
    mockedAuth.mockResolvedValueOnce(null);

    const denied = await requireActionUser();
    expect(denied?.message).toMatch(/signed in/i);
  });
});

describe("server action rate limiting (createAccount)", () => {
  it("rejects the mutation and writes no row once the budget is spent", async () => {
    await spendBudget(MAX_ACTIONS);

    const result = await createAccount(
      emptyState,
      makeFormData({ accountName: ACCOUNT_NAME, accountTypeId: "1" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/too many requests/i);

    const rows = await db
      .select({ accountId: accounts.accountId })
      .from(accounts)
      .where(eq(accounts.accountName, ACCOUNT_NAME));
    expect(rows).toHaveLength(0);
  });

  it("still works normally under the ceiling", async () => {
    const result = await createAccount(
      emptyState,
      makeFormData({ accountName: ACCOUNT_NAME, accountTypeId: "1" })
    );

    expect(result.success).toBe(true);
  });
});
