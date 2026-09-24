/**
 * Content Security Policy construction (Issue #237, follow-up to #182).
 *
 * Kept free of `next/*` imports and of `process.env`. Both matter: `proxy.ts`
 * imports this, and so does `next.config.ts` — which the Next config loader
 * evaluates *outside* the Next runtime, before a server exists. The same
 * constraint is recorded at the top of `rate-limit.ts` for the same reason.
 * `isDev` is therefore an argument rather than a read of NODE_ENV, which also
 * makes both exports pure and testable without stubbing the environment.
 *
 * ## Two layers, and which one wins
 *
 * The policy is emitted twice, on purpose:
 *
 *   - `next.config.ts` compiles a **nonce-free floor** into the routes-manifest,
 *     so it applies to everything the server emits — including the paths
 *     `proxy.ts` deliberately does not match (`/_next/static/*`, `/api/health`).
 *   - `proxy.ts` mints a per-request nonce and sets the **same policy plus that
 *     nonce** on every response that can carry HTML.
 *
 * The proxy's header replaces the config's rather than joining it. That is not
 * an assumption — `next/dist/server/lib/router-utils/resolve-routes.js` builds
 * its route list with `fsChecker.headers` (the routes-manifest entries) *before*
 * the `middleware` route, and both write `resHeaders[key] = value`. Last writer
 * wins, so exactly one `Content-Security-Policy` header ships and it is the
 * proxy's. Two headers would be catastrophic here — browsers enforce every
 * policy they are sent, so a nonce-bearing one and an `'unsafe-inline'` one
 * would intersect rather than override.
 *
 * The floor omits `'unsafe-inline'` from `script-src` in production, which makes
 * that arrangement **fail closed**: if the overwrite ever stopped happening,
 * Next's own inline bootstrap scripts would be blocked and the app would fail to
 * hydrate visibly, instead of quietly serving a weaker policy that still looks
 * fine in `curl -I`. `e2e/csp.spec.ts` is what catches that before a release.
 *
 * ## Why `style-src` still carries `'unsafe-inline'`
 *
 * Because two things outside this repository require it, and neither can be
 * fixed from here:
 *
 *   - `sonner` ships the whole of a toast's styling — 109 rules, ~15 KB,
 *     `position: fixed` among them — by building a `<style>` element in JS
 *     (`__insertCSS` in `sonner/dist/index.mjs`). It accepts no nonce. Nothing
 *     else styles a toast: `shadcn/tailwind.css` carries no sonner rules.
 *   - Next itself renders `<style dangerouslySetInnerHTML>` with no nonce prop
 *     in `next/dist/client/components/http-access-fallback/error-fallback.js`,
 *     which is what styles the built-in 404.
 *
 * So a nonce on `style-src` would unstyle every save/delete confirmation in the
 * app and Next's own error pages. This is an upstream constraint rather than
 * unfinished work — see docs/deployment.md, which names both. Do not "tidy" it
 * away without checking that both have shipped a nonce.
 *
 * Note that `'unsafe-inline'` here also covers React's `style={{…}}` attributes,
 * which 13 components render — `app/global-error.tsx` among them, where inline
 * styles are the *only* styling, by design (#129). Those are governed by
 * `style-src-attr`, which falls back to `style-src` when unset.
 */

type CspOptions = {
  /**
   * Per-request nonce from `mintNonce()`. Omitted for the floor compiled into
   * `next.config.ts`, and omitted in development — see `scriptSrc` below.
   */
  nonce?: string;
  isDev?: boolean;
};

/**
 * `script-src` is the whole point of #237 and the only directive that varies.
 *
 * The three cases are not interchangeable, and the reason a nonce and
 * `'unsafe-inline'` never appear together is a CSP3 rule that is easy to miss:
 * **a browser ignores `'unsafe-inline'` outright once a nonce or hash is
 * present.** Emitting both does not widen the policy, it silently discards the
 * fallback — which is exactly why the proxy mints no nonce in development,
 * where Turbopack's HMR runtime and error overlay inject inline scripts that
 * carry no nonce and cannot be given one.
 */
function scriptSrc({ nonce, isDev }: CspOptions): string {
  const sources = ["'self'"];

  if (nonce) {
    sources.push(`'nonce-${nonce}'`);
  } else if (isDev) {
    sources.push("'unsafe-inline'");
  }

  // Turbopack's dev server evaluates generated code. The production build does
  // not, so this stays out of it.
  if (isDev) sources.push("'unsafe-eval'");

  return `script-src ${sources.join(" ")}`;
}

/**
 * The narrow directives are narrow because the app genuinely needs nothing
 * more: `next/image` is unused and there is no `public/` directory, so `img-src`
 * needs no host; `next/font/google` downloads Geist at build time and serves it
 * from /_next/static, so `font-src 'self'` covers it; there are no third-party
 * scripts, CDNs or analytics anywhere; and Metabase runs as a separate
 * loopback-bound container rather than an embedded iframe, so nothing needs to
 * frame this app.
 */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const { isDev } = options;

  return [
    "default-src 'self'",
    scriptSrc(options),
    // See the module comment: upstream-constrained, not an oversight.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    // Turbopack opens an HMR websocket; the production build has none.
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * 128 bits of CSPRNG, base64-encoded.
 *
 * The encoding is not cosmetic. Next re-reads the policy it is handed on the
 * *request* and lifts the nonce back out of it to stamp onto its own bootstrap
 * and flight-data scripts, using
 *
 *     /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/
 *
 * from `next/dist/server/app-render/get-script-nonce-from-header.js`. A value
 * outside that character set does not raise anything — the match simply fails,
 * Next emits its scripts unstamped, and the page dies at hydration under the
 * policy we just set. `btoa` output (`A-Za-z0-9+/` plus `=` padding) is inside
 * it; a hex or URL-safe-base64 change here would not be. `csp.test.ts` asserts
 * against that regex verbatim.
 */
export function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
