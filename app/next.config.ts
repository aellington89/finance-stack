import type { NextConfig } from "next";

// Relative rather than the `@/` alias: the Next config loader evaluates this
// file outside the app's module resolution and is not guaranteed to honour
// tsconfig paths.
import { buildContentSecurityPolicy } from "./lib/security/csp";

/**
 * Security headers (Issue #182).
 *
 * These live here rather than only in `proxy.ts` because the proxy cannot cover
 * everything: `/_next/static/*` is excluded from its matcher so a Node
 * invocation is not spent on every asset, and `/api/health` is excluded so the
 * Docker healthcheck does not come to depend on Auth.js decoding a session.
 * `headers()` compiles into the routes-manifest, so it applies to everything the
 * server emits, survives `output: "standalone"`, and costs nothing per request.
 *
 * Verify with `curl -sI http://localhost:3001/` — see docs/deployment.md.
 *
 * ## This is the floor, not the policy most responses carry
 *
 * Issue #237 made the CSP nonce-based, and a nonce cannot be minted here — it
 * has to change per request. So `proxy.ts` builds the same policy with a nonce
 * added and overwrites this header on every response that can carry HTML. What
 * remains here is the floor for the handful of paths the proxy skips.
 *
 * The floor deliberately has **no** `'unsafe-inline'` on `script-src` in
 * production, even though nothing it covers executes an inline script. That
 * makes the two-layer arrangement fail closed: if the proxy's overwrite ever
 * stopped happening, Next's own inline bootstrap scripts would be blocked and
 * the app would fail to hydrate loudly, rather than quietly serving a weaker
 * policy that still looks correct to `curl -I`. `lib/security/csp.ts` documents
 * why the overwrite is an overwrite and not a second header, and why `style-src`
 * still carries `'unsafe-inline'` (sonner and Next's own 404 fallback both
 * inject a nonce-less `<style>`; neither is fixable from here).
 */
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = buildContentSecurityPolicy({ isDev });

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    // Ignored by browsers over plaintext per the HSTS spec, so it needs no
    // environment gate — it simply starts applying the day the app is reached
    // over TLS. `preload` is deliberately omitted: submission is effectively
    // irreversible and the hostname belongs to whoever deploys this, not to
    // the project.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    // Legacy companion to `frame-ancestors 'none'`, kept for older clients.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
];

const nextConfig: NextConfig = {
  // Produces a self-contained build at .next/standalone that bundles only
  // the necessary node_modules. Required for the multi-stage Docker image
  // defined in Issue #18.
  output: "standalone",

  // Suppresses `X-Powered-By: Next.js`, which names the framework and its
  // version range to anyone probing the port (#182).
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
