import { describe, it, expect } from "vitest";

import { buildContentSecurityPolicy, mintNonce } from "@/lib/security/csp";

/**
 * Issue #237. `next-config-headers.test.ts` asserts what the *floor* compiled
 * into the routes-manifest looks like; this asserts the builder underneath it,
 * including the nonce-bearing shape that only `proxy.ts` ever emits and that no
 * amount of reading next.config.ts can reach.
 */

function directives(csp: string): string[] {
  return csp.split(";").map((d) => d.trim());
}

function scriptSrc(csp: string): string {
  const directive = directives(csp).find((d) => d.startsWith("script-src"));
  if (!directive) throw new Error(`no script-src in: ${csp}`);
  return directive;
}

describe("buildContentSecurityPolicy", () => {
  it("carries a nonce and no unsafe-inline when given one", () => {
    const csp = buildContentSecurityPolicy({ nonce: "dGVzdC1ub25jZQ==" });

    expect(scriptSrc(csp)).toBe("script-src 'self' 'nonce-dGVzdC1ub25jZQ=='");
  });

  it("never emits a nonce and 'unsafe-inline' together", () => {
    // Not a style preference. CSP3 has browsers ignore 'unsafe-inline' outright
    // once a nonce or hash is present, so emitting both does not widen the
    // policy — it silently discards the fallback. Anything that made these
    // coexist would be a policy that reads more permissive than it behaves.
    for (const isDev of [true, false]) {
      const csp = buildContentSecurityPolicy({ nonce: "abc123", isDev });

      expect(scriptSrc(csp)).toContain("'nonce-abc123'");
      expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    }
  });

  it("falls back to 'self' alone for the production floor", () => {
    // next.config.ts cannot mint a nonce, so its header is this. Deliberately
    // stricter than the responses it covers need: nothing the proxy skips
    // (/_next/static, /api/health) runs an inline script, and leaving
    // 'unsafe-inline' out is what makes the two-layer arrangement fail closed.
    const csp = buildContentSecurityPolicy({});

    expect(scriptSrc(csp)).toBe("script-src 'self'");
  });

  it("relaxes script-src and connect-src in development for Turbopack HMR", () => {
    const csp = buildContentSecurityPolicy({ isDev: true });

    expect(scriptSrc(csp)).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(directives(csp)).toContain("connect-src 'self' ws:");
  });

  it("keeps the dev-only relaxations out of a production policy", () => {
    for (const options of [{}, { nonce: "abc123" }]) {
      const csp = buildContentSecurityPolicy(options);

      expect(csp).not.toContain("unsafe-eval");
      expect(csp).not.toContain("ws:");
      expect(directives(csp)).toContain("connect-src 'self'");
    }
  });

  it("retains 'unsafe-inline' on style-src in every shape", () => {
    // Upstream-constrained, NOT an oversight, and not the next thing to tighten
    // without checking both of these first:
    //
    //   - sonner builds a <style> element in JS (__insertCSS in
    //     sonner/dist/index.mjs) carrying the whole of a toast's styling, and
    //     accepts no nonce. A nonce here unstyles every save/delete
    //     confirmation in the app.
    //   - Next renders <style dangerouslySetInnerHTML> with no nonce prop in
    //     next/dist/client/components/http-access-fallback/error-fallback.js,
    //     which is what styles its built-in 404.
    //
    // It also covers React's style={{…}} attributes in 13 components, including
    // app/global-error.tsx where inline styles are the only styling by design
    // (#129): style-src-attr falls back to style-src when unset.
    for (const options of [{}, { isDev: true }, { nonce: "abc123" }]) {
      expect(directives(buildContentSecurityPolicy(options))).toContain(
        "style-src 'self' 'unsafe-inline'"
      );
    }
  });

  it("locks down the directives that carry the policy's real value", () => {
    const csp = directives(buildContentSecurityPolicy({ nonce: "abc123" }));

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self'");
  });
});

describe("mintNonce", () => {
  /**
   * Copied verbatim from Next's
   * `dist/server/app-render/get-script-nonce-from-header.js`, which is what
   * lifts the nonce back out of the request CSP to stamp onto Next's own inline
   * scripts. A nonce outside this character set raises nothing — the match just
   * fails, the scripts ship unstamped, and the page dies at hydration under the
   * very policy that named the nonce. That is the failure this asserts against.
   */
  const CSP_NONCE_SOURCE_REGEX = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

  it("produces a value Next can read back out of the header", () => {
    for (let i = 0; i < 100; i++) {
      expect(`'nonce-${mintNonce()}'`).toMatch(CSP_NONCE_SOURCE_REGEX);
    }
  });

  it("produces a different value every call", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => mintNonce()));

    expect(seen.size).toBe(1000);
  });

  it("carries 128 bits of entropy", () => {
    // 16 bytes base64 is 24 characters including one '=' of padding. A shorter
    // value would still match the regex above and still look like a nonce.
    expect(mintNonce()).toHaveLength(24);
  });
});
