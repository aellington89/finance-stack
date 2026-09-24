import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { buildContentSecurityPolicy, mintNonce } from "@/lib/security/csp";

/**
 * Next.js 16 proxy (the renamed middleware.ts, Node.js runtime).
 *
 * Two jobs, and they are why this is a function rather than the bare
 * `export { auth as proxy }` it used to be:
 *
 *  1. **Auth.** Redirect unauthenticated requests on protected paths to /login.
 *     Not the security boundary on its own: the (app) layout re-checks auth()
 *     and every server action is gated by requireActionUser().
 *  2. **The nonce-bearing CSP (#237).** Mint a nonce per request and set the
 *     policy on both the response and the forwarded request headers.
 *
 * ## Why the auth check moved here
 *
 * This used to be the `authorized` callback in auth.ts. Passing a function to
 * `auth()` does not merely stop that callback being consulted — it makes it a
 * silent no-op. `handleAuth` in next-auth/lib/index.js still *calls* it, then
 * reaches `else if (userMiddlewareOrRoute)` and discards whatever it returned;
 * the `else if (!authorized)` branch that performs the redirect is unreachable
 * once a middleware function is supplied. A callback left behind in auth.ts
 * would therefore have read as the gate while gating nothing, so it was deleted
 * rather than kept. The redirect below reproduces its behaviour exactly, down to
 * cloning nextUrl so the original query string survives alongside callbackUrl.
 *
 * ## Why the matcher is now nearly everything
 *
 * Next lifts the nonce back out of the *request* CSP header to stamp its own
 * bootstrap and flight-data scripts, so every response that can carry HTML has
 * to pass through here — not just the four protected trees. Two exclusions are
 * deliberate rather than incidental:
 *
 *   - `_next/static` and `_next/image`: assets, not documents. Nothing inline to
 *     protect, and a Node invocation per asset is not free.
 *   - `api/health`: keeping it out means the Docker healthcheck and the release
 *     smoke test never come to depend on Auth.js decoding a session, which is a
 *     property worth preserving deliberately. "/api/health/seed-data" rides
 *     along on the same prefix; it gates itself with auth() and answers 401
 *     (#191), which is the right answer for a JSON endpoint — matching it here
 *     would redirect a denied caller to /login and a monitor would read the
 *     resulting 200 HTML page as success.
 *
 * Both keep the floor CSP compiled into next.config.ts, so no response ships
 * without one.
 */

// Same four trees the matcher used to name. "/accounts" and "/dashboard" are
// distinct page trees, not nested, so both are listed.
const PROTECTED_PREFIXES = ["/dashboard", "/accounts", "/settings", "/test-ui"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

const isDev = process.env.NODE_ENV !== "production";

export const proxy = auth((req) => {
  // No nonce in development. A nonce makes browsers ignore 'unsafe-inline'
  // entirely (CSP3), and Turbopack's HMR runtime and error overlay inject
  // inline scripts that carry none — so minting one here would break `next dev`
  // while changing nothing about what ships. The nonce path is exercised by the
  // e2e suite, which runs the production build (playwright.config.ts).
  const nonce = isDev ? undefined : mintNonce();
  const csp = buildContentSecurityPolicy({ nonce, isDev });

  if (!req.auth?.user && isProtectedPath(req.nextUrl.pathname)) {
    const signInUrl = req.nextUrl.clone();
    signInUrl.pathname = "/login";
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);

    // The old arrangement could not do this: a proxy redirect is generated
    // before next.config.ts's headers layer, so these short-circuited responses
    // carried no CSP. They have no body, so nothing was exposed by it, but
    // setting it here costs nothing and closes the gap.
    const redirect = NextResponse.redirect(signInUrl);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  if (!nonce) {
    // Development: this is byte-identical to the floor next.config.ts compiles,
    // so setting it is a no-op that keeps one code path instead of two.
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const requestHeaders = new Headers(req.headers);
  // `x-nonce` is what app/layout.tsx reads. The CSP header is what *Next* reads:
  // app-render.js runs getScriptNonceFromHeader() over the request's
  // content-security-policy and stamps the result onto its own inline scripts.
  // Both are required — neither implies the other.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
