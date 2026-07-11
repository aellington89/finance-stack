import { describe, it, expect, afterEach } from "vitest";
import type { Mock } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/drizzle/schema";
import { auth } from "@/auth";
import { createAccount } from "@/lib/actions/account";

// vitest-setup.ts mocks @/auth with an authenticated session by default;
// the unauthenticated case below overrides it for a single call.
const mockedAuth = auth as unknown as Mock;

const ACCOUNT_NAME = "Auth Gate Test";
const emptyState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.append(key, val);
  }
  return fd;
}

afterEach(async () => {
  await db.delete(accounts).where(eq(accounts.accountName, ACCOUNT_NAME));
});

describe("server action auth gating (createAccount)", () => {
  it("rejects an unauthenticated call and writes no row", async () => {
    mockedAuth.mockResolvedValueOnce(null);

    const result = await createAccount(
      emptyState,
      makeFormData({ accountName: ACCOUNT_NAME, accountTypeId: "1" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/signed in/i);

    const rows = await db
      .select({ accountId: accounts.accountId })
      .from(accounts)
      .where(eq(accounts.accountName, ACCOUNT_NAME));
    expect(rows).toHaveLength(0);
  });

  it("accepts an authenticated call and writes the row", async () => {
    const result = await createAccount(
      emptyState,
      makeFormData({ accountName: ACCOUNT_NAME, accountTypeId: "1" })
    );

    expect(result.success).toBe(true);

    const rows = await db
      .select({ accountId: accounts.accountId })
      .from(accounts)
      .where(eq(accounts.accountName, ACCOUNT_NAME));
    expect(rows).toHaveLength(1);
  });
});
