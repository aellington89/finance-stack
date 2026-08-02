import {
  RATE_LIMITS,
  isRateLimited,
  recordEvent,
  resetLimit,
  retryAfterSeconds,
} from "@/lib/security/rate-limit";

/**
 * Sign-in rate-limit policy (Issue #182). `rate-limit.ts` is the mechanism;
 * this is the policy — the same split as `log.ts` (mechanism) and `report.ts`
 * (policy).
 *
 * It exists mostly to keep the key derivation in **one** place. Two call sites
 * share this budget — `authorize()` in `auth.ts`, which enforces it, and
 * `authenticate()` in `lib/actions/auth.ts`, which peeks at it to render a
 * useful message — and if their keys ever drifted apart the counter and the
 * message would silently describe different things.
 *
 * Kept free of `next/*` and the database: `auth.ts` imports this, and
 * `proxy.ts` imports `auth.ts`.
 */

/**
 * Lowercased even though the lookup in `verify-credentials.ts` is
 * case-sensitive. Key normalization has to be at least as aggressive as lookup
 * normalization, never less: lowercasing can only merge two spellings into one
 * budget, whereas leaving case alone would hand `Admin` and `admin` a separate
 * five attempts each — and so on for every capitalization of the name.
 */
function loginKey(username: string): string {
  return `login:${username.trim().toLowerCase()}`;
}

/** Whether this username has spent its failed-attempt budget. Does not count. */
export function isLoginRateLimited(username: string): boolean {
  return isRateLimited(loginKey(username), RATE_LIMITS.login);
}

/**
 * Counts one *failed* sign-in. Successes are never counted, so a legitimate
 * user is only ever limited by their own mistakes, and only until the window
 * rolls over.
 */
export function recordFailedLogin(username: string): void {
  recordEvent(loginKey(username), RATE_LIMITS.login);
}

/** Clears the budget after a successful sign-in. */
export function clearLoginRateLimit(username: string): void {
  resetLimit(loginKey(username));
}

/** Whole minutes until this username may try again, floored at 1. */
export function loginRetryAfterMinutes(username: string): number {
  return Math.max(1, Math.ceil(retryAfterSeconds(loginKey(username)) / 60));
}
