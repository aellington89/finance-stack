import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mocked before the import under test, following tests/unit/lib/db/audited.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { actionFailure } = await import("@/lib/actions/failure");
const { auth } = await import("@/auth");
const mockedAuth = auth as unknown as Mock;

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  consoleError.mockClear();
  mockedAuth.mockReset();
  mockedAuth.mockResolvedValue({
    user: { id: "11111111-2222-3333-4444-555555555555", name: "ada" },
  });
});

function parsed() {
  expect(consoleError).toHaveBeenCalledOnce();
  return JSON.parse(consoleError.mock.calls[0][0] as string) as Record<string, never>;
}

describe("actionFailure", () => {
  it("returns the friendly ActionState the form renders", () => {
    // The user-facing contract is unchanged by the refactor: shape and message
    // are exactly what the old inline `return { success: false, ... }` produced.
    return expect(
      actionFailure("createAccount", new Error("boom"), "Failed to create account. Please try again.")
    ).resolves.toEqual({
      success: false,
      errors: {},
      message: "Failed to create account. Please try again.",
    });
  });

  it("logs the action name and the signed-in actor", async () => {
    await actionFailure("deleteTransaction", new Error("fk violation"), "nope");

    const record = parsed();
    expect(record.level).toBe("error");
    expect(record.action).toBe("deleteTransaction");
    expect(record.user_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(record.msg).toBe("deleteTransaction failed");
  });

  it("logs the real error, not the message shown to the user", () => {
    // The point of the split: the operator gets the cause, the user gets copy.
    return actionFailure(
      "updateAccount",
      new Error("connection terminated unexpectedly"),
      "Failed to update account. Please try again."
    ).then(() => {
      const err = parsed().err as Record<string, unknown>;
      expect(err.message).toBe("connection terminated unexpectedly");
    });
  });

  it("still logs and still returns when there is no session", async () => {
    mockedAuth.mockResolvedValue(null);

    const result = await actionFailure("createAccount", new Error("boom"), "nope");

    expect(result).toEqual({ success: false, errors: {}, message: "nope" });

    const record = parsed();
    expect(record.action).toBe("createAccount");
    expect(record).not.toHaveProperty("user_id");
  });

  it("does not throw when auth() rejects", async () => {
    // A logging helper on the error path must not replace the original failure
    // with one of its own.
    mockedAuth.mockRejectedValue(new Error("jwt decode failed"));

    await expect(
      actionFailure("createAccount", new Error("original"), "nope")
    ).resolves.toEqual({ success: false, errors: {}, message: "nope" });

    const err = parsed().err as Record<string, unknown>;
    expect(err.message).toBe("original");
  });

  it("emits a single line even with a multi-frame stack", async () => {
    await actionFailure("createAccount", new Error("boom"), "nope");

    expect(consoleError.mock.calls[0][0] as string).not.toContain("\n");
  });
});
