import { describe, it, expect, afterEach, beforeAll } from "vitest";
import type { Mock } from "vitest";
import { eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountTypeCategories,
  accountTypes,
  auditLog,
  transactionCategories,
  transactionTypes,
  users,
} from "@/drizzle/schema";
import { auth } from "@/auth";
import {
  createAccountTypeCategory,
  updateAccountTypeCategory,
  deleteAccountTypeCategory,
  createTransactionType,
  createTransactionCategory,
  createAccountType,
} from "@/lib/actions/categories";
import { __resetAllLimits } from "@/lib/security/rate-limit";

// The role gate from Issue #87.
//
// These sign in as *real rows* in `users` rather than asserting against a
// mocked role, because the thing under test is that requireAdminUser() reads
// the database. Sessions here are 30-day JWTs with no server-side revocation
// (docs/auth.md), so a token-based check would leave a demoted admin
// privileged for up to a month — the "stale token" case below is what pins
// that down, and it is the test that fails if the lookup is ever optimised
// away.

const mockedAuth = auth as unknown as Mock;

const emptyState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) fd.append(key, val);
  return fd;
}

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

// Signs in as the given row. mockResolvedValue rather than ...Once: the admin
// path reads the session twice (the session/rate gate, then the role lookup).
function signInAs(userId: string, tokenRole: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: `test-${tokenRole}`, role: tokenRole },
    expires: "2099-01-01T00:00:00.000Z",
  });
}

beforeAll(async () => {
  await db
    .insert(users)
    .values([
      { userId: ADMIN_ID, username: "gate-admin", passwordHash: "x", role: "admin" },
      { userId: USER_ID, username: "gate-user", passwordHash: "x", role: "user" },
    ])
    .onConflictDoUpdate({ target: users.userId, set: { role: sql`excluded.role` } });
});

const createdCategoryNames = ["Gate Probe Category"];
const createdTypeNames = ["Gate Probe Type"];

afterEach(async () => {
  // vitest-setup.ts installs the default admin session; restore it so a test
  // file running after this one is unaffected.
  mockedAuth.mockResolvedValue({
    user: {
      id: "00000000-0000-0000-0000-000000000000",
      name: "integration-test-user",
      role: "admin",
    },
    expires: "2099-01-01T00:00:00.000Z",
  });
  __resetAllLimits();

  await db
    .delete(accountTypeCategories)
    .where(inArray(accountTypeCategories.accountTypeCategory, createdCategoryNames));
  await db
    .delete(transactionTypes)
    .where(inArray(transactionTypes.transactionType, createdTypeNames));
  await db
    .delete(transactionCategories)
    .where(inArray(transactionCategories.transactionCategory, createdCategoryNames));
  await db
    .delete(accountTypes)
    .where(eq(accountTypes.accountType, "Gate Probe Account Type"));
});

async function auditHighWater(): Promise<number> {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${auditLog.auditId}), 0)` })
    .from(auditLog);
  return max;
}

async function auditRowsSince(max: number) {
  return db.select({ id: auditLog.auditId }).from(auditLog).where(gt(auditLog.auditId, max));
}

// ── The four admin-only actions ───────────────────────────────────────────

const ADMIN_ONLY = [
  {
    name: "createAccountTypeCategory",
    run: () =>
      createAccountTypeCategory(emptyState, makeFormData({ name: "Gate Probe Category" })),
  },
  {
    name: "updateAccountTypeCategory",
    run: () =>
      updateAccountTypeCategory(
        emptyState,
        makeFormData({ accountTypeCategoryId: "1", name: "Current Asset" })
      ),
  },
  {
    name: "deleteAccountTypeCategory",
    run: () =>
      deleteAccountTypeCategory(emptyState, makeFormData({ accountTypeCategoryId: "1" })),
  },
  {
    name: "createTransactionType",
    run: () => createTransactionType(emptyState, makeFormData({ name: "Gate Probe Type" })),
  },
];

describe("requireAdminUser — refusal", () => {
  for (const { name, run } of ADMIN_ONLY) {
    it(`refuses ${name} for a non-admin, writing no row and no audit entry`, async () => {
      signInAs(USER_ID, "user");
      const before = await auditHighWater();

      const result = await run();

      expect(result.success).toBe(false);
      expect(result.message).toBe("You do not have permission to perform this action.");
      expect(await auditRowsSince(before)).toEqual([]);
    });
  }

  it("refuses a session whose user row no longer exists", async () => {
    signInAs("33333333-3333-3333-3333-333333333333", "admin");

    const result = await createAccountTypeCategory(
      emptyState,
      makeFormData({ name: "Gate Probe Category" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);
  });

  it("refuses a stale token still claiming admin after the row was demoted", async () => {
    // The case the whole database read exists for. The cookie says admin; the
    // row says user. With a token-based check this would pass for up to 30
    // days, because nothing revokes a JWT.
    signInAs(USER_ID, "admin");

    const result = await createAccountTypeCategory(
      emptyState,
      makeFormData({ name: "Gate Probe Category" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);

    const rows = await db
      .select({ id: accountTypeCategories.accountTypeCategoryId })
      .from(accountTypeCategories)
      .where(eq(accountTypeCategories.accountTypeCategory, "Gate Probe Category"));
    expect(rows).toEqual([]);
  });

  it("answers the session gate before the role gate", async () => {
    // Ordering matters: a signed-out caller must not learn that the endpoint
    // exists and is admin-only.
    mockedAuth.mockResolvedValue(null);

    const result = await createAccountTypeCategory(
      emptyState,
      makeFormData({ name: "Gate Probe Category" })
    );

    expect(result.message).toMatch(/must be signed in/i);
    expect(result.message).not.toMatch(/permission/i);
  });
});

describe("requireAdminUser — admission", () => {
  it("lets an admin create an account type category", async () => {
    signInAs(ADMIN_ID, "admin");

    const result = await createAccountTypeCategory(
      emptyState,
      makeFormData({ name: "Gate Probe Category" })
    );

    expect(result.success).toBe(true);
    const rows = await db
      .select({ id: accountTypeCategories.accountTypeCategoryId })
      .from(accountTypeCategories)
      .where(eq(accountTypeCategories.accountTypeCategory, "Gate Probe Category"));
    expect(rows).toHaveLength(1);
  });

  it("lets an admin create a transaction type — the affordance #109 removed", async () => {
    signInAs(ADMIN_ID, "admin");

    const result = await createTransactionType(
      emptyState,
      makeFormData({ name: "Gate Probe Type" })
    );

    expect(result.success).toBe(true);
    const rows = await db
      .select({ id: transactionTypes.transactionTypeId })
      .from(transactionTypes)
      .where(eq(transactionTypes.transactionType, "Gate Probe Type"));
    expect(rows).toHaveLength(1);
  });

  it("admits a token claiming `user` when the row says admin", async () => {
    // The mirror of the stale-token case: the database wins in both
    // directions, so a promotion takes effect without waiting for the cookie.
    signInAs(ADMIN_ID, "user");

    const result = await createAccountTypeCategory(
      emptyState,
      makeFormData({ name: "Gate Probe Category" })
    );

    expect(result.success).toBe(true);
  });
});

// ── The #81 decision, made executable ─────────────────────────────────────
//
// #81 proposed gating all of /settings/categories on admin; #87 requires the
// CRUD on transaction_categories and account_types to stay available to
// regular users. #87 won — that page is where a user names their own
// categories, and since #111 it is also where they tag a reporting role. If
// somebody later gates the page, these fail.

describe("a regular user keeps their own CRUD", () => {
  it("can create a transaction category, and tag it with a reporting role", async () => {
    signInAs(USER_ID, "user");

    const result = await createTransactionCategory(
      emptyState,
      makeFormData({ name: "Gate Probe Category", reportingRole: "debt_principle_paid" })
    );

    expect(result.success).toBe(true);
  });

  it("can create an account type", async () => {
    signInAs(USER_ID, "user");

    const result = await createAccountType(
      emptyState,
      makeFormData({ name: "Gate Probe Account Type", accountTypeCategoryId: "1" })
    );

    expect(result.success).toBe(true);
  });
});
