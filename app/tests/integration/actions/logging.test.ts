import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/drizzle/schema";
import { createAccount } from "@/lib/actions/account";

/**
 * End-to-end proof of the structured error logging in Issue #129, against a
 * real drizzle + pg failure rather than a hand-built fixture.
 *
 * The redaction unit tests in tests/unit/lib/report.test.ts model what
 * DrizzleQueryError looks like; this file is what stops that model from
 * drifting away from what the driver actually throws.
 */

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// Appears in the failing statement's bound parameters, so it is the marker for
// "did a row value survive into the log".
const ACCOUNT_NAME = "Logging Redaction Probe";

// Passes accountFormSchema (an integer > 0) but has no row in account_types,
// so the insert reaches the database and fails there — the genuine catch path,
// not a validation short-circuit.
const MISSING_ACCOUNT_TYPE_ID = "999999";

const emptyState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) fd.append(key, val);
  return fd;
}

function emittedLine(): string {
  expect(consoleError).toHaveBeenCalledOnce();
  return consoleError.mock.calls[0][0] as string;
}

function emittedRecord() {
  return JSON.parse(emittedLine()) as Record<string, never>;
}

beforeEach(() => consoleError.mockClear());

afterEach(async () => {
  await db.delete(accounts).where(eq(accounts.accountName, ACCOUNT_NAME));
});

afterAll(() => consoleError.mockRestore());

describe("server action failure logging", () => {
  it("returns the user-facing message and writes no row", async () => {
    const result = await createAccount(
      emptyState,
      makeFormData({
        accountName: ACCOUNT_NAME,
        accountTypeId: MISSING_ACCOUNT_TYPE_ID,
      })
    );

    // Behaviour-preserving: this is exactly what the pre-#129 inline
    // `return { success: false, ... }` produced.
    expect(result).toEqual({
      success: false,
      errors: {},
      message: "Failed to create account. Please try again.",
    });

    const rows = await db
      .select({ accountId: accounts.accountId })
      .from(accounts)
      .where(eq(accounts.accountName, ACCOUNT_NAME));
    expect(rows).toHaveLength(0);
  });

  it("emits one line of JSON with level, action and the signed-in actor", async () => {
    await createAccount(
      emptyState,
      makeFormData({
        accountName: ACCOUNT_NAME,
        accountTypeId: MISSING_ACCOUNT_TYPE_ID,
      })
    );

    const line = emittedLine();
    expect(line).not.toContain("\n");

    const record = emittedRecord();
    expect(record.level).toBe("error");
    expect(record.action).toBe("createAccount");
    expect(record.msg).toBe("createAccount failed");
    // The session mocked in tests/integration/vitest-setup.ts.
    expect(record.user_id).toBe("00000000-0000-0000-0000-000000000000");
    expect(Date.parse(record.ts as string)).not.toBeNaN();
  });

  it("keeps enough of the driver error to diagnose the failure", async () => {
    await createAccount(
      emptyState,
      makeFormData({
        accountName: ACCOUNT_NAME,
        accountTypeId: MISSING_ACCOUNT_TYPE_ID,
      })
    );

    const err = emittedRecord().err as Record<string, Record<string, unknown>>;

    // drizzle wraps the driver error; the SQLSTATE lives on the cause.
    expect(err.message).toContain('Failed query: insert into "accounts"');
    expect(err.cause.code).toBe("23503");
    expect(err.cause.constraint).toBe("accounts_account_type_id_fkey");
    expect(err.cause.table).toBe("accounts");
  });

  it("leaves no row value anywhere in the emitted line", async () => {
    await createAccount(
      emptyState,
      makeFormData({
        accountName: ACCOUNT_NAME,
        accountTypeId: MISSING_ACCOUNT_TYPE_ID,
      })
    );

    const line = emittedLine();

    // DrizzleQueryError.message is "Failed query: <sql>\nparams: <values>" and
    // err.stack repeats it — both must be stripped. Without this, every failed
    // write would log the whole row it was trying to save.
    expect(line).not.toContain(ACCOUNT_NAME);
    expect(line).not.toContain("params:");

    // pg's own detail field echoes the offending value back.
    expect(line).not.toContain("is not present in table");
    expect(line).not.toContain("Key (account_type_id)");

    // The parameterized SQL survives — placeholders, not values.
    expect(line).toContain("$1");
  });

  it("logs nothing on the success path", async () => {
    // accountTypeId 1 is seeded by vitest-setup.ts.
    const result = await createAccount(
      emptyState,
      makeFormData({ accountName: ACCOUNT_NAME, accountTypeId: "1" })
    );

    expect(result.success).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
