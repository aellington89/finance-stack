import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __resetAllLimits } from "@/lib/security/rate-limit";
import {
  clearLoginRateLimit,
  isLoginRateLimited,
  loginRetryAfterMinutes,
  recordFailedLogin,
} from "@/lib/security/login-limit";

/** RATE_LIMITS.login.max — the number of failures the budget allows. */
const MAX_FAILURES = 5;

function failTimes(username: string, times: number): void {
  for (let i = 0; i < times; i++) recordFailedLogin(username);
}

beforeEach(() => {
  __resetAllLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("login rate limit", () => {
  it("allows the first four failures and blocks on the fifth", () => {
    failTimes("alice", MAX_FAILURES - 1);
    expect(isLoginRateLimited("alice")).toBe(false);

    recordFailedLogin("alice");
    expect(isLoginRateLimited("alice")).toBe(true);
  });

  it("budgets each username separately", () => {
    failTimes("alice", MAX_FAILURES);
    expect(isLoginRateLimited("alice")).toBe(true);
    expect(isLoginRateLimited("bob")).toBe(false);
  });

  it("clears the budget on a successful sign-in", () => {
    failTimes("alice", MAX_FAILURES);
    expect(isLoginRateLimited("alice")).toBe(true);

    clearLoginRateLimit("alice");
    expect(isLoginRateLimited("alice")).toBe(false);
  });

  it("lifts the block once the window has elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    failTimes("alice", MAX_FAILURES);
    expect(isLoginRateLimited("alice")).toBe(true);

    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(isLoginRateLimited("alice")).toBe(false);
  });
});

describe("key normalization", () => {
  it("shares one budget across capitalizations", () => {
    // The whole point: without lowercasing, "Alice" would hand an attacker a
    // second five attempts, "ALICE" a third, and so on indefinitely.
    recordFailedLogin("alice");
    recordFailedLogin("Alice");
    recordFailedLogin("ALICE");
    recordFailedLogin("aLiCe");
    expect(isLoginRateLimited("alice")).toBe(false);

    recordFailedLogin("AlIcE");
    expect(isLoginRateLimited("alice")).toBe(true);
    expect(isLoginRateLimited("ALICE")).toBe(true);
  });

  it("shares one budget across surrounding whitespace", () => {
    // Matches the trim() that verify-credentials.ts applies before the lookup.
    failTimes("  alice  ", MAX_FAILURES);
    expect(isLoginRateLimited("alice")).toBe(true);
  });

  it("clears across capitalizations too", () => {
    failTimes("alice", MAX_FAILURES);
    clearLoginRateLimit("ALICE");
    expect(isLoginRateLimited("alice")).toBe(false);
  });
});

describe("loginRetryAfterMinutes()", () => {
  it("reports the remaining window in whole minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    recordFailedLogin("alice");
    expect(loginRetryAfterMinutes("alice")).toBe(15);

    vi.advanceTimersByTime(10 * 60_000);
    expect(loginRetryAfterMinutes("alice")).toBe(5);
  });

  it("never says 0 minutes — the message would read as 'try again in 0'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    recordFailedLogin("alice");
    vi.advanceTimersByTime(15 * 60_000 - 500);
    expect(loginRetryAfterMinutes("alice")).toBe(1);
  });

  it("floors at 1 for an untracked username", () => {
    expect(loginRetryAfterMinutes("never-seen")).toBe(1);
  });
});
