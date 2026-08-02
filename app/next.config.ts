import type { NextConfig } from "next";

/**
 * Security headers (Issue #182).
 *
 * These live here rather than in `proxy.ts` because the proxy's matcher covers
 * four page trees — /dashboard, /accounts, /settings, /test-ui — and headers
 * set there would miss `/`, `/login`, `/api/*` and `/_next/*`, which is most of
 * what an unauthenticated caller can reach. `headers()` compiles into the
 * routes-manifest, so it applies to everything the server emits, survives
 * `output: "standalone"`, and costs nothing per request.
 *
 * The one gap: responses the proxy short-circuits (the unauthenticated
 * /dashboard → /login redirect) are generated before this layer. Those carry no
 * body, so nothing is exposed by it.
 *
 * Verify with `curl -sI http://localhost:3001/` — see docs/deployment.md.
 */
const isDev = process.env.NODE_ENV !== "production";

/**
 * `'unsafe-inline'` is load-bearing in two places and cannot be dropped without
 * the nonce work tracked as a follow-up to #182:
 *
 *   - script-src: next-themes injects a blocking inline script from
 *     `app/layout.tsx` to set the theme class before paint (the FOUC guard).
 *   - style-src: `components/ui/chart.tsx` injects a <style> element via
 *     dangerouslySetInnerHTML to emit each chart's --color-* variables. It is
 *     the only dangerouslySetInnerHTML in the app.
 *
 * What the rest of the policy still buys, despite that: `default-src`/
 * `connect-src 'self'` block loading from and exfiltrating to any other origin,
 * `form-action 'self'` stops a credential form being retargeted at an attacker,
 * `base-uri 'self'` stops <base> hijacking every relative URL on the page, and
 * `object-src 'none'` removes the plugin surface entirely.
 *
 * The narrow directives are narrow because the app genuinely needs nothing
 * more: `next/image` is unused and there is no `public/` directory, so `img-src`
 * needs no host; `next/font/google` downloads Geist at build time and serves it
 * from /_next/static, so `font-src 'self'` covers it; there are no third-party
 * scripts, CDNs or analytics anywhere; and Metabase runs as a separate
 * loopback-bound container rather than an embedded iframe, so nothing needs to
 * frame this app.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // Turbopack's dev server evaluates generated code and opens an HMR websocket;
  // neither exists in the production build, so both stay out of it.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
