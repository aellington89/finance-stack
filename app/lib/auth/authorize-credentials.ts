import { log } from "@/lib/log";
import {
  verifyCredentials,
  type AuthUser,
} from "@/lib/auth/verify-credentials";
import {
  clearLoginRateLimit,
  isLoginRateLimited,
  recordFailedLogin,
} from "@/lib/security/login-limit";

/**
 * The body of the Credentials provider's `authorize()` callback: rate limit,
 * then verify, then account for the outcome.
 *
 * Kept out of `auth.ts` for the same reason `verifyCredentials` is — the
 * NextAuth config cannot be imported by the test suite, because `next-auth`
 * reaches for the `next/server` runtime that the Vitest projects do not
 * provide. Everything here is importable, so the real enforcement path gets
 * exercised against a real user row rather than re-implemented in a test.
 *
 * This is the one funnel every credential attempt passes through. The login
 * form posts to `/login` as a *server action*, not to `/api/auth/*` — but
 * `/api/auth/callback/credentials` is directly POST-able too, so limiting
 * either route alone would leave the other wide open (#182).
 *
 * The limit is keyed on username only, not on IP. `auth.ts` imports this and
 * `proxy.ts` imports `auth.ts`, so nothing on the path may reach for
 * `next/headers`; and with no reverse proxy in front by default,
 * `X-Forwarded-For` is absent or spoofed anyway. The consequence is stated
 * plainly in docs/deployment.md rather than glossed: someone who knows the
 * username can hold the real user out for the length of one window.
 */
export async function authorizeCredentials(
  username: string,
  password: string
): Promise<AuthUser | null> {
  // Checked before verifyCredentials, which matters twice over: scrypt is
  // expensive by design, so an unthrottled attempt is a cheap DoS lever as
  // well as a brute-force one.
  if (isLoginRateLimited(username)) {
    // No username in the record: someone who types their password into the
    // username field would otherwise put it straight into the logs.
    log.warn("Sign-in rejected by rate limit", {
      scope: "login",
      entry_point: "authorize",
    });
    return null;
  }

  const user = await verifyCredentials(username, password);

  if (!user) {
    recordFailedLogin(username);
    return null;
  }

  clearLoginRateLimit(username);

  return user;
}
