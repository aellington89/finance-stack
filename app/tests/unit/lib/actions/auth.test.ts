import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";

/**
 * `lib/actions/auth.ts` cannot be imported in the integration project — pulling
 * `AuthError` from `next-auth` drags in internals that need the `next/server`
 * runtime (see the header of tests/integration/actions/validation-contract.test.ts).
 * Mocking both `next-auth` and `@/auth` sidesteps that, following the
 * vi.mock + `await import` ordering idiom from tests/unit/lib/db/audited.test.ts.
 *
 * The real limiter is left unmocked: the point of these cases is that the
 * action and authorize() agree on the same budget.
 */
class FakeAuthError extends Error {}

vi.mock("next-auth", () => ({ AuthError: FakeAuthError }));

const signIn = vi.fn();
vi.mock("@/auth", () => ({ signIn, signOut: vi.fn() }));

const { authenticate } = await import("@/lib/actions/auth");
const { __resetAllLimits } = await import("@/lib/security/rate-limit");
const { recordFailedLogin } = await import("@/lib/security/login-limit");

const emptyState = { success: false, errors: {}, message: "" };

function credentials(username: string): FormData {
  const fd = new FormData();
  fd.append("username", username);
  fd.append("password", "hunter2");
  return fd;
}

function failTimes(username: string, times: number): void {
  for (let i = 0; i < times; i++) recordFailedLogin(username);
}

beforeEach(() => {
  __resetAllLimits();
  vi.clearAllMocks();
});

describe("authenticate()", () => {
  it("returns the generic message on bad credentials", async () => {
    (signIn as Mock).mockRejectedValueOnce(new FakeAuthError("nope"));

    const result = await authenticate(emptyState, credentials("alice"));

    expect(result.success).toBe(false);
    expect(result.message).toBe("Invalid username or password.");
  });

  it("rethrows the redirect a successful sign-in raises", async () => {
    // signIn redirects on success, which surfaces as a non-AuthError throw.
    const redirect = new Error("NEXT_REDIRECT");
    (signIn as Mock).mockRejectedValueOnce(redirect);

    await expect(
      authenticate(emptyState, credentials("alice"))
    ).rejects.toThrow(redirect);
  });
});

describe("authenticate() when rate limited", () => {
  it("reports the lockout instead of the generic failure", async () => {
    failTimes("alice", 5);

    const result = await authenticate(emptyState, credentials("alice"));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/too many sign-in attempts/i);
    expect(result.message).toMatch(/15 minutes/);
  });

  it("never reaches signIn, so a locked-out attempt costs no scrypt work", async () => {
    failTimes("alice", 5);

    await authenticate(emptyState, credentials("alice"));

    expect(signIn).not.toHaveBeenCalled();
  });

  it("blocks a locked-out username regardless of how it is capitalized", async () => {
    failTimes("alice", 5);

    const result = await authenticate(emptyState, credentials("ALICE"));

    expect(result.message).toMatch(/too many sign-in attempts/i);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("leaves other usernames alone", async () => {
    failTimes("alice", 5);
    (signIn as Mock).mockRejectedValueOnce(new FakeAuthError("nope"));

    const result = await authenticate(emptyState, credentials("bob"));

    expect(result.message).toBe("Invalid username or password.");
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("singularizes the last minute of the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    failTimes("alice", 5);
    vi.advanceTimersByTime(14 * 60_000 + 30_000);

    const result = await authenticate(emptyState, credentials("alice"));

    expect(result.message).toContain("1 minute.");
    expect(result.message).not.toContain("1 minutes");
    vi.useRealTimers();
  });

  it("does not put the submitted username in the message", async () => {
    // The username field is where a mistyped password lands.
    failTimes("alice", 5);

    const result = await authenticate(emptyState, credentials("alice"));

    expect(result.message).not.toContain("alice");
  });
});
