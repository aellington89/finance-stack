/**
 * Fixed-window rate limiting (Issue #182).
 *
 * Zero dependencies on purpose. There is no Redis in this stack, a Postgres
 * write per login attempt would make the limiter its own amplification vector,
 * and any new runtime dependency lands in the *blocking* `npm audit --omit=dev`
 * gate plus the Trivy image scan — the same reasoning `lib/report.ts` records
 * for why no error-tracking SDK ships. One container, one process, so an
 * in-memory counter is the honest fit.
 *
 * **Stated limitations**, documented in docs/deployment.md rather than glossed:
 * counters live in process memory, so they reset when the container restarts
 * and they do not span replicas. A lockout is a speed bump measured in minutes,
 * not a durable ban.
 *
 * Deliberately pure: no `@/auth`, no `next/*`, no database, no logging. Call
 * sites log their own rejections (`lib/auth/guard.ts`, `auth.ts`) because only
 * they know which fields are safe to record. Purity also means this module is
 * safe to import from `auth.ts`, which `proxy.ts` in turn imports — anything
 * reaching for `next/headers` here would break that chain.
 */

export interface RateLimitRule {
  /** Events allowed within one window before the key is limited. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMITS = {
  /**
   * Failed sign-ins per username. Only failures count, so succeeding never
   * costs a legitimate user anything. Five is tight enough to make an online
   * password search hopeless and loose enough to survive a fat-fingered
   * password manager.
   */
  login: { max: 5, windowMs: 15 * 60_000 },
  /**
   * Mutations per signed-in user. An abuse blunt, not a UX gate: normal use
   * peaks in the low single digits per minute, so 120 leaves two orders of
   * magnitude of headroom while still bounding a runaway client or a stolen
   * session.
   */
  action: { max: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

interface Window {
  count: number;
  /** Epoch ms at which this window expires and the count starts over. */
  resetAt: number;
}

/**
 * Ceiling on tracked keys, so keys an attacker chooses (usernames are
 * attacker-supplied) cannot grow the map without bound. Expired entries are
 * pruned first; only if that fails to get under the cap does eviction start,
 * oldest-inserted first — `Map` iterates in insertion order.
 *
 * The residual: flooding 10,000 distinct usernames inside one window would
 * evict a real lockout early. That flood is itself the abuse an in-process
 * limiter cannot fully answer, and the cap is the lesser of the two failure
 * modes — bounded memory beats a perfectly-retained counter.
 */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Held on `globalThis` so every bundle Next builds (server components, server
 * actions, route handlers) shares one map rather than counting separately.
 * This mirrors the pg `Pool` in `lib/db/index.ts`, with one difference: that
 * one only assigns in development because its purpose is surviving HMR. Here
 * the shared-across-bundles property matters in production too, so the
 * assignment is unconditional.
 */
const globalForRateLimit = globalThis as unknown as {
  rateLimitWindows?: Map<string, Window>;
};

const windows: Map<string, Window> =
  globalForRateLimit.rateLimitWindows ?? new Map<string, Window>();

globalForRateLimit.rateLimitWindows = windows;

/** Drops expired entries, then evicts oldest-first if still over the cap. */
function evictIfNeeded(now: number): void {
  if (windows.size < MAX_TRACKED_KEYS) return;

  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }

  for (const key of windows.keys()) {
    if (windows.size < MAX_TRACKED_KEYS) break;
    windows.delete(key);
  }
}

/**
 * Whether `key` has already spent its budget. A peek — it never creates or
 * mutates a window, so calling it on every request is free of side effects and
 * an unlimited key costs nothing but a map lookup.
 */
export function isRateLimited(key: string, rule: RateLimitRule): boolean {
  const window = windows.get(key);
  if (!window) return false;
  if (window.resetAt <= Date.now()) return false;
  return window.count >= rule.max;
}

/**
 * Counts one event against `key`. Starts a fresh window when there is none or
 * the previous one has expired, so the window is anchored to the first event
 * in it rather than sliding forward with every subsequent one.
 *
 * What counts as an event is the caller's policy, not this module's: the login
 * budget counts only failures, the action budget counts every attempt.
 */
export function recordEvent(key: string, rule: RateLimitRule): void {
  const now = Date.now();
  const window = windows.get(key);

  if (!window || window.resetAt <= now) {
    evictIfNeeded(now);
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }

  window.count += 1;
}

/** Clears `key`'s budget. Called after a successful sign-in. */
export function resetLimit(key: string): void {
  windows.delete(key);
}

/**
 * Whole seconds until `key`'s window expires, for the user-facing message.
 * Zero when the key is untracked or already expired.
 */
export function retryAfterSeconds(key: string): number {
  const window = windows.get(key);
  if (!window) return 0;
  return Math.max(0, Math.ceil((window.resetAt - Date.now()) / 1000));
}

/**
 * Test-only. The map is module state shared across an entire Vitest process,
 * and the integration project runs `fileParallelism: false` — without a reset
 * between tests the mutation limiter would carry counts from one file into the
 * next. Called from a `beforeEach` in `tests/integration/vitest-setup.ts`.
 */
export function __resetAllLimits(): void {
  windows.clear();
}
