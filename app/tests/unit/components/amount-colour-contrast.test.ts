import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { amountColorClass } from "@/lib/format/financial";

/**
 * Encodes Issue #406: amounts must be coloured with semantic gain/loss tokens
 * that pass WCAG AA (4.5:1) on `bg-card` in both themes, not with raw Tailwind
 * palette greens and reds.
 *
 * The colour model is the one from Issue #362
 * (tests/unit/components/destructive-contrast.test.ts): OKLCH → 8-bit sRGB,
 * WCAG 2.x relative luminance, 4.5:1. The "before" values it reproduces are
 * green-500 2.22, red-500 3.81, green-600 3.22, red-600 4.77, emerald-600
 * 3.65 and, in dark mode, green-400 10.08 / red-400 6.21 on the dark card.
 */

const AA_TEXT = 4.5;
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type Rgb = readonly [number, number, number];
type Oklch = readonly [l: number, c: number, h: number];

function oklchToRgb([l, c, h]: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((v) => v ** 3);
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  return linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(255 * encoded);
  }) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const globalsCss = readFileSync(resolve(APP_ROOT, "app/globals.css"), "utf8");

function themeBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(globalsCss);
  if (!match) throw new Error(`globals.css has no top-level \`${selector} { … }\` block`);
  return match[1];
}

function token(block: string, name: string): Oklch {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`--${name} is not declared in this theme block`);
  const parts = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(match[1].trim());
  if (!parts) throw new Error(`--${name} is not a plain oklch(L C H)`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

function ratios(selector: string) {
  const block = themeBlock(selector);
  const card = oklchToRgb(token(block, "card"));
  return {
    gain: contrast(oklchToRgb(token(block, "gain")), card),
    loss: contrast(oklchToRgb(token(block, "loss")), card),
  };
}

/** Files that paint an amount, and therefore must use the semantic tokens. */
const AMOUNT_SOURCES = [
  "components/dashboard/accounting-kpi-card.tsx",
  "components/dashboard/debt-service-summary.tsx",
  "components/accounts/accounts-by-category.tsx",
  "lib/format/financial.ts",
  "app/(app)/test-ui/page.tsx",
];

describe("the #362 contrast model is reused for amounts", () => {
  it("reproduces the ratios the issue measured for the raw palette colours", () => {
    // Card is oklch(1 0 0) in light and oklch(0.205 0 0) in dark.
    const white = oklchToRgb([1, 0, 0]);
    const darkCard = oklchToRgb([0.205, 0, 0]);
    const ratio = (fg: Oklch, bg: Rgb) => contrast(oklchToRgb(fg), bg);
    expect(ratio([0.723, 0.219, 149.579], white)).toBeCloseTo(2.22, 1); // green-500
    expect(ratio([0.637, 0.237, 25.331], white)).toBeCloseTo(3.81, 1); // red-500
    expect(ratio([0.627, 0.194, 149.214], white)).toBeCloseTo(3.22, 1); // green-600
    expect(ratio([0.577, 0.245, 27.325], white)).toBeCloseTo(4.77, 1); // red-600
    expect(ratio([0.596, 0.145, 163.225], white)).toBeCloseTo(3.65, 1); // emerald-600
    expect(ratio([0.792, 0.209, 151.711], darkCard)).toBeCloseTo(10.08, 1); // green-400
    expect(ratio([0.704, 0.191, 22.216], darkCard)).toBeCloseTo(6.21, 1); // red-400
  });
});

describe("gain/loss tokens (Issue #406)", () => {
  it("passes AA on bg-card in light mode", () => {
    const light = ratios(":root");
    expect(light.gain).toBeGreaterThanOrEqual(AA_TEXT);
    expect(light.loss).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("passes AA on bg-card in dark mode", () => {
    const dark = ratios(".dark");
    expect(dark.gain).toBeGreaterThanOrEqual(AA_TEXT);
    expect(dark.loss).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("amount call sites use the tokens, not the raw palette", () => {
  it("amountColorClass returns semantic classes", () => {
    expect(amountColorClass(1)).toBe("text-gain");
    expect(amountColorClass(-1)).toBe("text-loss");
    expect(amountColorClass(0)).toBe("");
  });

  for (const file of AMOUNT_SOURCES) {
    it(`${file} uses text-gain/text-loss and no raw palette green/red`, () => {
      const source = readFileSync(resolve(APP_ROOT, file), "utf8");
      expect(source).not.toMatch(/(?:^|\s)text-(?:green|red|emerald|rose|lime|teal)-\d{3}(?=\s|"|')/);
      expect(source).toContain("text-gain");
      expect(source).toContain("text-loss");
    });
  }
});
