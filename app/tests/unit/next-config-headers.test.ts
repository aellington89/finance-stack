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
  it("locks down the directives that still bite despite unsafe-inline", async () => {
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
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("relaxes script-src and connect-src in development for Turbopack HMR", async () => {
    const csp = (await headersFor("development")).get("Content-Security-Policy") ?? "";

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
  });

  it("still carries unsafe-inline, which the nonce follow-up removes", async () => {
    // next-themes' FOUC script and the <style> injected by components/ui/chart.tsx
    // both require it. Asserted so that dropping it is a deliberate change with a
    // failing test attached, not an accident.
    const csp = (await headersFor("production")).get("Content-Security-Policy") ?? "";

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});
