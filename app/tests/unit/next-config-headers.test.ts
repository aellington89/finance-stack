import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Encodes the acceptance criteria of Issue #182 ("security headers present on
 * responses") as a CI gate. `ci.yml` never boots the app, so this is the only
 * header check that runs on every push — the `curl -I` assertions in the
 * release smoke test only run on a tag.
 *
 * NODE_ENV has to be stubbed *before* the config module is imported: the CSP is
 * built once at module load, and the dev-only relaxations are the thing most
 * worth asserting are absent from a production build.
 */
async function headersFor(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);

  const { default: config } = await import("@/next.config");
  const rules = await config.headers!();

  const rule = rules.find((r) => r.source === "/:path*");
  if (!rule) throw new Error("no header rule matches /:path*");

  return new Map(rule.headers.map((h) => [h.key, h.value]));
}

function directives(csp: string | undefined): string[] {
  return (csp ?? "").split(";").map((d) => d.trim());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("security headers", () => {
  it("applies to every path, not just the proxy's matcher", async () => {
    const { default: config } = await import("@/next.config");
    const rules = await config.headers!();

    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
  });

  it("sets every header the issue calls for", async () => {
    const headers = await headersFor("production");

    expect(headers.get("Content-Security-Policy")).toBeTruthy();
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("does not offer HSTS preload", async () => {
    // Preload submission is effectively irreversible and applies to a hostname
    // the deployer chooses, not this project.
    const headers = await headersFor("production");
    expect(headers.get("Strict-Transport-Security")).not.toContain("preload");
  });

  it("suppresses X-Powered-By", async () => {
    vi.resetModules();
    const { default: config } = await import("@/next.config");
    expect(config.poweredByHeader).toBe(false);
  });
});

describe("content security policy", () => {
  it("locks down the directives that carry the policy's real value", async () => {
    const csp = directives((await headersFor("production")).get("Content-Security-Policy"));

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self'");
  });

  it("keeps the dev-only relaxations out of a production build", async () => {
    const csp = (await headersFor("production")).get("Content-Security-Policy") ?? "";

    // Turbopack needs both; the standalone server needs neither.
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("relaxes script-src and connect-src in development for Turbopack HMR", async () => {
    const csp = (await headersFor("development")).get("Content-Security-Policy") ?? "";

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
  });

  it("carries no unsafe-inline on script-src, and no nonce either", async () => {
    // #237. This file can only ever see the *floor*: next.config.ts compiles one
    // header into the routes-manifest at build time and a nonce has to change
    // per request, so the policy most responses actually carry is set by
    // proxy.ts and overwrites this one. What is asserted here is that the floor
    // is strict enough to fail closed — if that overwrite ever stopped
    // happening, Next's own inline bootstrap scripts would be blocked and the
    // app would fail to hydrate visibly, rather than quietly serving a weaker
    // policy that still looks right to `curl -I`.
    //
    // The nonce-bearing shape is asserted in tests/unit/lib/security/csp.test.ts,
    // and that it reaches the wire in e2e/csp.spec.ts.
    const csp = (await headersFor("production")).get("Content-Security-Policy") ?? "";

    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("nonce-");
  });

  it("still carries unsafe-inline on style-src, for two upstream reasons", async () => {
    // Neither is fixable from this repository, and both must ship a nonce
    // before this line changes:
    //
    //   - sonner builds a <style> element in JS (__insertCSS in
    //     sonner/dist/index.mjs) carrying the whole of a toast's styling — 109
    //     rules, position: fixed among them — and accepts no nonce. Nothing else
    //     styles a toast. A nonce here unstyles every save and delete
    //     confirmation in the app.
    //   - Next renders <style dangerouslySetInnerHTML> with no nonce prop in
    //     next/dist/client/components/http-access-fallback/error-fallback.js,
    //     which is what styles its built-in 404.
    //
    // Asserted rather than merely commented so that dropping it is a deliberate
    // change with a failing test attached, not an accident — the same reason the
    // script-src half was asserted here before #237 removed it.
    const csp = (await headersFor("production")).get("Content-Security-Policy") ?? "";

    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});
