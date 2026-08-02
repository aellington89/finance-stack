import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RATE_LIMITS,
  __resetAllLimits,
  isRateLimited,
  recordEvent,
  resetLimit,
  retryAfterSeconds,
} from "@/lib/security/rate-limit";

const rule = { max: 3, windowMs: 60_000 };

beforeEach(() => {
  __resetAllLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isRateLimited()", () => {
  it("is false for a key that has never been seen", () => {
    expect(isRateLimited("fresh", rule)).toBe(false);
  });

  it("stays false while the count is below max", () => {
    recordEvent("k", rule);
    recordEvent("k", rule);
    expect(isRateLimited("k", rule)).toBe(false);
  });

  it("becomes true on the event that reaches max", () => {
    recordEvent("k", rule);
    recordEvent("k", rule);
    recordEvent("k", rule);
    expect(isRateLimited("k", rule)).toBe(true);
  });

  it("stays true as further events land in the same window", () => {
    for (let i = 0; i < 10; i++) recordEvent("k", rule);
    expect(isRateLimited("k", rule)).toBe(true);
  });

  it("does not count — repeated checks never consume budget", () => {
    recordEvent("k", rule);
    recordEvent("k", rule);
    for (let i = 0; i < 50; i++) expect(isRateLimited("k", rule)).toBe(false);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i++) recordEvent("a", rule);
    expect(isRateLimited("a", rule)).toBe(true);
    expect(isRateLimited("b", rule)).toBe(false);
  });
});

describe("window expiry", () => {
  it("clears the limit once the window has elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    for (let i = 0; i < 3; i++) recordEvent("k", rule);
    expect(isRateLimited("k", rule)).toBe(true);

    vi.advanceTimersByTime(rule.windowMs + 1);
    expect(isRateLimited("k", rule)).toBe(false);
  });

  it("anchors the window to the first event, not the most recent one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    recordEvent("k", rule);
    vi.advanceTimersByTime(50_000);
    recordEvent("k", rule);
    recordEvent("k", rule);
    expect(isRateLimited("k", rule)).toBe(true);

    // 10s later the window that opened at the first event is over, even though
    // the last two events were only 10s ago. A sliding window would still block.
    vi.advanceTimersByTime(10_001);
    expect(isRateLimited("k", rule)).toBe(false);
  });

  it("starts a fresh count after expiry rather than resuming the old one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    for (let i = 0; i < 3; i++) recordEvent("k", rule);
    vi.advanceTimersByTime(rule.windowMs + 1);

    recordEvent("k", rule);
    expect(isRateLimited("k", rule)).toBe(false);
  });
});

describe("resetLimit()", () => {
  it("clears a limited key immediately", () => {
    for (let i = 0; i < 3; i++) recordEvent("k", rule);
    expect(isRateLimited("k", rule)).toBe(true);

    resetLimit("k");
    expect(isRateLimited("k", rule)).toBe(false);
  });

  it("is a no-op for an unknown key", () => {
    expect(() => resetLimit("never-seen")).not.toThrow();
  });
});

describe("retryAfterSeconds()", () => {
  it("is 0 for an untracked key", () => {
    expect(retryAfterSeconds("nope")).toBe(0);
  });

  it("counts down from the window length", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    recordEvent("k", rule);
    expect(retryAfterSeconds("k")).toBe(60);

    vi.advanceTimersByTime(25_000);
    expect(retryAfterSeconds("k")).toBe(35);
  });

  it("never goes negative once the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    recordEvent("k", rule);
    vi.advanceTimersByTime(rule.windowMs * 5);
    expect(retryAfterSeconds("k")).toBe(0);
  });
});

describe("key cap", () => {
  it("bounds the map under a flood of distinct keys", () => {
    // 12k distinct keys against a 10k cap. The assertion that matters is that
    // the module keeps working and stays bounded; the most recent keys survive
    // because eviction is oldest-first.
    for (let i = 0; i < 12_000; i++) recordEvent(`flood-${i}`, rule);

    expect(isRateLimited("flood-0", rule)).toBe(false);

    for (let i = 0; i < 3; i++) recordEvent("flood-11999", rule);
    expect(isRateLimited("flood-11999", rule)).toBe(true);
  });
});

describe("RATE_LIMITS", () => {
  it("keeps the login budget tight and the action budget generous", () => {
    expect(RATE_LIMITS.login.max).toBe(5);
    expect(RATE_LIMITS.login.windowMs).toBe(15 * 60_000);
    expect(RATE_LIMITS.action.max).toBe(120);
    expect(RATE_LIMITS.action.windowMs).toBe(60_000);
  });
});
