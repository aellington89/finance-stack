# Authentication

Single-user, session-based authentication built on [Auth.js (NextAuth v5)](https://authjs.dev/) with a Credentials provider. Usernames and scrypt password hashes live in the `users` table; sessions are stateless JWTs in an HTTP-only cookie. Added in [#120](https://github.com/aellington89/finance-stack/issues/120).

## The model

- **Who can sign in:** rows in the `users` table. There is no self-registration UI — users are created with the CLI below.
- **Sessions:** the Credentials provider forces Auth.js's JWT strategy (database sessions are not supported with Credentials). Signing in sets a signed, HTTP-only session cookie; signing out clears it. There is no server-side session revocation — acceptable for the single-user model. Rotating `AUTH_SECRET` invalidates all outstanding sessions.
- **Passwords:** hashed with `scrypt` from `node:crypto` (random 16-byte salt, timing-safe comparison) in `app/lib/auth/password.ts`. No native dependencies, so it works in the Alpine standalone Docker image.
- **Roles:** each user has a `role` column (default `admin`). Nothing is gated on it yet; it pre-wires the admin-vs-regular split planned for [#81](https://github.com/aellington89/finance-stack/issues/81)/[#87](https://github.com/aellington89/finance-stack/issues/87).

## Defense in depth

Enforcement is layered, following Auth.js's own guidance to never rely on middleware alone:

1. **Proxy** ([`app/proxy.ts`](../app/proxy.ts), Next.js 16's renamed `middleware.ts`) — redirects unauthenticated requests on `/dashboard`, `/accounts`, `/settings`, and `/test-ui` to `/login`, preserving the original destination via `callbackUrl`. First line of defense and the best UX, but bypassable in principle (cf. CVE-2025-29927), so never the only check.
2. **Layout gate** ([`app/app/(app)/layout.tsx`](../app/app/(app)/layout.tsx)) — calls `auth()` and redirects to `/login` when there is no session. Covers every authenticated page and the queries they render.
3. **Per-action guard** (`requireActionUser()` in [`app/lib/auth/guard.ts`](../app/lib/auth/guard.ts)) — the first statement of every server action under `app/lib/actions/`. Server actions are directly POST-able regardless of which page renders them, so this is the real boundary for the mutation surface. Unauthenticated calls get an unauthorized `ActionState`, never a DB write. The same guard also applies the per-user mutation rate limit ([#182](https://github.com/aellington89/finance-stack/issues/182)), so every guarded action is covered by construction — including ones added later.

Deliberately public: the landing page (`/`), `/login`, Auth.js's own `/api/auth/*` routes, and `/api/health` — the Docker healthcheck and the release smoke test poll it unauthenticated.

## Sign-in rate limiting

Five failed sign-ins per username per 15 minutes ([#182](https://github.com/aellington89/finance-stack/issues/182)). Only failures count and a success clears the tally, so a legitimate user is only ever limited by their own mistakes.

Enforcement lives in [`app/lib/auth/authorize-credentials.ts`](../app/lib/auth/authorize-credentials.ts) rather than in a route or the proxy, because that is the one path every credential attempt reaches: the login form posts to `/login` as a **server action**, not to `/api/auth/*`, while `/api/auth/callback/credentials` is directly POST-able. Limiting either route alone would leave the other open. The check runs before the password is verified, so a blocked attempt never pays for a `scrypt` comparison — which makes it a denial-of-service control as much as a brute-force one.

`authenticate()` in `app/lib/actions/auth.ts` peeks at the same budget before calling `signIn`, purely so a locked-out user sees "Too many sign-in attempts. Try again in N minutes." instead of the generic failure. That module is also why the logic sits in `lib/auth/` — `auth.ts` cannot be imported by the test suite, so keeping it separate is what makes the enforcement path testable, the same reasoning that put `verifyCredentials` there.

The limit is keyed on **username, not IP**, and the counters live in process memory. Both are deliberate trades with real consequences — see [Deployment & Exposure](deployment.md#limitations-stated-plainly).

## Creating the first user (and resetting passwords)

```bash
cd app
npm run auth:create-user -- <username>
```

The script prompts twice for the password (hidden input, 8-character minimum) and upserts the user — **re-running it with an existing username resets that user's password**.

It targets `DATABASE_URL`, falling back to `app/.env.local` (which points at `Finances_Test` for local development). To create the user in the real `Finances` database of the Docker stack, override it (password from your root `.env`, port 5433 on the host):

```bash
DATABASE_URL=postgresql://postgres:<password>@localhost:5433/Finances \
  npm run auth:create-user -- <username>
```

> **This must connect as `postgres`, not `finance_app`.** The `users` table is deliberately read-only to the application role (Issue #130), so that an app-level compromise cannot mint or alter an account. Running the CLI as `finance_app` fails with `permission denied for table users` — that is the guard working, not a bug. See [Roles & Privileges](database.md#roles--privileges).

For non-interactive use, set `CREATE_USER_PASSWORD` instead of the prompt.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `AUTH_SECRET` | `app/.env.local` (dev), root `.env` → `finance-app` container (Docker) | Signs/encrypts the session JWT. **Required.** Generate with `openssl rand -base64 33` (or `npx auth secret`). Rotating it signs everyone out. |

The NextAuth config sets `trustHost: true` in code (`app/auth.ts`), so `AUTH_TRUST_HOST` does not need to be set anywhere — the app is self-hosted behind Docker with no fixed public URL, which is exactly the case that option exists for.

## Sign-in / sign-out flow

- **Sign in:** `/login` (username + password). On success you land on the page you originally requested (via `callbackUrl`) or `/dashboard`. Failures show a generic "Invalid username or password." — unknown-user and wrong-password are indistinguishable by design.
- **Sign out:** the "Sign out" button in the sidebar footer clears the session cookie and returns to `/login`.
- **Session lifetime:** Auth.js default — 30-day cookie, refreshed on activity. An expired or absent cookie behaves exactly like being signed out: redirect to `/login`, actions rejected.

## Scope and follow-ups

Authentication ≠ internet-ready. Rate limiting and security headers landed in [#182](https://github.com/aellington89/finance-stack/issues/182), and a TLS-terminating proxy ships switched off — but the default posture is still a trusted network, and going public has a checklist. See [Deployment & Exposure](deployment.md). Secret management remains open in [#181](https://github.com/aellington89/finance-stack/issues/181), under the security epic [#100](https://github.com/aellington89/finance-stack/issues/100). Phase 2 of [#120](https://github.com/aellington89/finance-stack/issues/120) (per-user `user_id` columns + Postgres RLS) and role-gated lookup-table CRUD ([#81](https://github.com/aellington89/finance-stack/issues/81)/[#87](https://github.com/aellington89/finance-stack/issues/87)) build on this foundation.
