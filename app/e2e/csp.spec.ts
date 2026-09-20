import { test, expect, type Page } from "@playwright/test";

/**
 * The Content Security Policy, as a browser actually applies it (Issue #237).
 *
 * **Why this is a second spec**, when money-path.spec.ts opens by explaining
 * that one path is deliberate and "a suite of two is where an E2E suite starts
 * costing more than it catches": three of #237's acceptance criteria are not
 * observable anywhere else. `tests/unit/lib/security/csp.test.ts` asserts the
 * policy string and `next-config-headers.test.ts` asserts the floor, but no unit
 * test can see whether Next stamped the nonce onto its own inline scripts,
 * whether the theme script survived, or whether anything on the page was
 * refused — those are facts about a browser, and getting them wrong means a
 * blank page in production.
 *
 * It earns its place by being cheap in the way the original objection was about:
 * it writes nothing to the database, so it cannot race the money path or need
 * teardown, and it reuses the session that spec already established.
 *
 * playwright.config.ts runs `next build && next start`, which matters here more
 * than anywhere: the nonce exists **only** in a production build. `next dev`
 * serves the 'unsafe-inline' policy (see lib/security/csp.ts), so a dev server
 * would pass this file while testing the opposite of what ships.
 */

type Violation = { directive: string; blockedURI: string; sample: string };

declare global {
  interface Window {
    __cspViolations: Violation[];
  }
}

/**
 * Records violations from inside the page.
 *
 * `addInitScript` runs before any of the document's own scripts, so the
 * listener is in place before the parser reaches the inline scripts this is
 * watching. The console listener is a backstop for anything the event misses.
 */
async function watchForViolations(page: Page): Promise<string[]> {
  const consoleErrors: string[] = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (/content security policy|refused to (execute|apply|load)/i.test(text)) {
      consoleErrors.push(text);
    }
  });

  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
        sample: event.sample ?? "",
      });
    });
  });

  return consoleErrors;
}

async function readViolations(page: Page): Promise<Violation[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

function nonceFrom(csp: string): string | undefined {
  return csp.match(/'nonce-([^']+)'/)?.[1];
}

// Public, authenticated, chart-bearing, and not-found.
//
// /dashboard/accounting earns its place: its pie chart is the one whose
// ChartConfig keys come from database category names, which is the sink the
// #237 chart refactor closed. Real names there contain spaces and "&", so they
// are refused by the key filter in components/ui/chart.tsx and emit nothing —
// as they should, since the slices take their colours from `fill` on each Cell
// and never resolved those variables. This sweep is what proves the page still
// renders clean after that filtering.
//
// Not /test-ui, tempting as it is as the one page that resolves --color-*
// through var(): it calls notFound() unless NODE_ENV is development, and this
// suite runs the production build, so it would assert against a 404.
const ROUTES = [
  "/",
  "/login",
  "/dashboard",
  "/dashboard/net-worth",
  "/dashboard/accounting",
];

test.describe("content security policy", () => {
  test("no route reports a violation", async ({ page }) => {
    const consoleErrors = await watchForViolations(page);

    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      expect(
        await readViolations(page),
        `CSP violations on ${route}`
      ).toEqual([]);
    }

    // A 404 renders Next's own fallback, which is a different render path and
    // was prerendered before #237 made every route dynamic.
    await page.goto("/no-such-page-exists");
    await page.waitForLoadState("networkidle");
    expect(await readViolations(page), "CSP violations on a 404").toEqual([]);

    expect(consoleErrors, "CSP complaints in the console").toEqual([]);
  });

  test("ships one nonce-bearing policy, fresh on every request", async ({
    page,
  }) => {
    const first = await page.goto("/");
    const csp = first?.headers()["content-security-policy"] ?? "";

    // The header is singular. Two CSP headers would both be enforced rather
    // than one overriding the other, so a nonce-bearing policy alongside an
    // 'unsafe-inline' one would intersect to something nobody wrote.
    expect(csp).toBeTruthy();
    expect(csp.split(",")).toHaveLength(1);

    const nonce = nonceFrom(csp);
    expect(nonce, `no nonce in: ${csp}`).toBeTruthy();

    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    // A nonce reused across requests is no better than 'unsafe-inline' — it
    // becomes a guessable constant — and nothing static could detect it.
    const second = await page.goto("/?cache-buster=1");
    const secondNonce = nonceFrom(
      second?.headers()["content-security-policy"] ?? ""
    );
    expect(secondNonce).toBeTruthy();
    expect(secondNonce).not.toBe(nonce);
  });

  test("every inline script carries the nonce the header names", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard");
    const nonce = nonceFrom(response?.headers()["content-security-policy"] ?? "");

    // `el.nonce`, never `getAttribute("nonce")` and never a `[nonce]` selector.
    // Browsers blank the content attribute once they have consumed it and keep
    // the value only on the IDL property — deliberately, so that a CSS
    // attribute selector cannot exfiltrate the nonce and hand an attacker the
    // means to author a script that passes. Reading the attribute here reports
    // every script as unstamped even when the served HTML is correct.
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script"))
        .filter((el) => !el.src)
        .map((el) => ({
          nonce: el.nonce ?? "",
          preview: el.textContent?.slice(0, 80) ?? "",
        }))
    );

    expect(
      scripts.filter((s) => !s.nonce).map((s) => s.preview),
      "inline scripts with no nonce"
    ).toEqual([]);

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script.nonce).toBe(nonce);
  });
});

test.describe("what the policy could have broken", () => {
  test("the theme applies before first paint and toggles", async ({ page }) => {
    // The FOUC guard is next-themes' inline script, which is the whole reason
    // script-src needed a nonce. If it were refused, the class would be absent
    // on arrival and the page would paint light before correcting itself.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/dashboard", { waitUntil: "commit" });
    await page.waitForFunction(() =>
      document.documentElement.classList.contains("dark")
    );

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/dashboard", { waitUntil: "commit" });
    await page.waitForFunction(() =>
      document.documentElement.classList.contains("light")
    );
  });

  test("charts resolve their colour variables in both themes", async ({
    page,
  }) => {
    // #237 moved these off an injected <style> and onto the container's style
    // attribute. Reading them back through getComputedStyle is what proves the
    // custom properties still reach the marks that use var(--color-*).
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/dashboard/net-worth");

      const container = page.locator("[data-chart]").first();
      await expect(container).toBeAttached();

      const resolved = await container.evaluate((el) => {
        const style = getComputedStyle(el);
        return Array.from(el.getAttribute("style")?.matchAll(/(--color-[\w-]+)/g) ?? [])
          .map((match) => style.getPropertyValue(match[1]).trim())
          .filter(Boolean);
      });

      expect(
        resolved.length,
        `no --color-* resolved on a chart in ${colorScheme} mode`
      ).toBeGreaterThan(0);
    }
  });

  test("sonner's injected stylesheet is not refused", async ({ page }) => {
    // The reason style-src still carries 'unsafe-inline' (#237). sonner builds
    // this <style> in JS and accepts no nonce, and it is the only thing that
    // styles a toast — so a future tightening of style-src would leave every
    // save and delete confirmation as unstyled text in the document flow. An
    // empty or absent sheet here is that regression, without needing to write a
    // row to provoke a toast.
    // sonner injects from module scope in a client chunk, so the element does
    // not exist until hydration has run that chunk — later than `load`.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const rules = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("style")).find((node) =>
        node.textContent?.includes("data-sonner-toaster")
      );
      if (!el) return -1;
      try {
        return el.sheet?.cssRules.length ?? 0;
      } catch {
        return 0;
      }
    });

    expect(rules, "sonner's stylesheet was blocked or never inserted").toBeGreaterThan(0);
  });
});
