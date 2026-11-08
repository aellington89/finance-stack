import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buttonVariants } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";

/**
 * Encodes the acceptance criteria of Issue #362 — destructive buttons pass WCAG
 * AA text contrast (4.5:1) in light mode, and still pass in dark mode — as a CI
 * gate.
 *
 * The destructive Button and Badge paint `text-destructive` on a tint of the
 * same token (`bg-destructive/10`, `/20` on hover). The red on its own passed;
 * the tint behind it is what pulled it under, to 3.93:1 in a dialog footer. The
 * fix lives in the token (`--destructive` in app/globals.css) rather than in
 * the generated `components/ui/*.tsx`, and that is exactly why it needs a gate:
 * `npx shadcn init`, or re-applying a theme, writes upstream's value back, and
 * upstream's value fails too. Nothing else would notice.
 *
 * **This is a model, and axe in a real browser is the authority.** It
 * composites in 8-bit sRGB the way the browser paints, then takes the WCAG 2.x
 * ratio. The calibration case below pins it to axe's live readings from #148,
 * so the gate cannot drift into measuring something the browser does not
 * show. When a value changes, re-measure live (docs/testing.md, "Colour
 * contrast is a model, calibrated against axe") and, if the model and axe ever
 * disagree by more than the tolerance, the model is the one that is wrong.
 * After #362 the live readings were 5.59 / 4.65 (footer, at rest / hover) and
 * 5.80 / 4.84 (card), against the model's 5.60 / 4.66 and 5.80 / 4.84.
 *
 * Both inputs come from the real sources: the token values from globals.css,
 * the tint alphas from the variants' own class strings. A regenerated variant
 * is therefore re-checked automatically, and one that stops using the
 * tint-on-tint pattern fails here, loudly, rather than passing unmeasured.
 */

const AA_TEXT = 4.5;

type Rgb = readonly [number, number, number];
type Oklch = readonly [l: number, c: number, h: number];

// --- colour math -----------------------------------------------------------

/** OKLCH → 8-bit sRGB, via OKLab (Björn Ottosson's matrices), clipped to gamut. */
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
  const [r, g, bl] = linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(255 * encoded);
  });
  return [r, g, bl];
}

/** `fg` at `alpha` painted over an opaque `bg`, rounded to 8 bits like a paint. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const [r, g, b] = fg.map((v, i) => Math.round(alpha * v + (1 - alpha) * bg[i]));
  return [r, g, b];
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

// --- the surfaces ----------------------------------------------------------

interface Theme {
  destructive: Oklch;
  background: Oklch;
  card: Oklch;
  muted: Oklch;
}

/**
 * The two places a destructive control sits, built from a theme:
 * - `footer`: every confirm button. DialogFooter's `bg-muted/50` over
 *   DialogContent's `bg-background` (components/ui/dialog.tsx).
 * - `card`: the Delete Account trigger, in a CardHeader, and the "Breaking
 *   migration" badge on /settings/about — both on `bg-card`
 *   (components/ui/card.tsx).
 */
function backdrops(theme: Theme) {
  return {
    footer: over(oklchToRgb(theme.muted), 0.5, oklchToRgb(theme.background)),
    card: oklchToRgb(theme.card),
  };
}

/** Ratio of `text-destructive` on `bg-destructive/<alpha>` over `backdrop`. */
function tintRatio(theme: Theme, alpha: number, backdrop: Rgb): number {
  const red = oklchToRgb(theme.destructive);
  return contrast(red, over(red, alpha, backdrop));
}

// --- reading the real sources ----------------------------------------------

const globalsCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../app/globals.css"),
  "utf8",
);

function themeBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(globalsCss);
  if (!match) throw new Error(`globals.css has no top-level \`${selector} { … }\` block`);
  return match[1];
}

function token(block: string, name: string): Oklch {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`--${name} is not declared in this theme block`);
  const value = match[1].trim();
  // Plain oklch(L C H) only: an alpha, or a switch to hex or hsl, changes what
  // the tint composites over, and the model should be revisited rather than
  // guessed at.
  const parts = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!parts) throw new Error(`--${name} is \`${value}\`, not a plain oklch(L C H)`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

function readTheme(selector: string): Theme {
  const block = themeBlock(selector);
  return {
    destructive: token(block, "destructive"),
    background: token(block, "background"),
    card: token(block, "card"),
    muted: token(block, "muted"),
  };
}

/**
 * The alpha of one `bg-destructive/<n>` class, matched with its exact variant
 * prefix ("" for the resting light state, "hover:", "dark:", …). Anchored on
 * whitespace so `hover:` never matches inside `dark:hover:`, nor
 * `bg-destructive/` inside `aria-invalid:ring-destructive/20`.
 */
function tintAlpha(classes: string, prefix: string): number {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}bg-destructive/(\\d+)(?=\\s|$)`).exec(classes);
  if (!match) {
    throw new Error(
      `no \`${prefix}bg-destructive/<n>\` in the variant any more — it no longer ` +
        `paints the tint this gate models, so re-measure it live (Issue #362)`,
    );
  }
  return Number(match[1]) / 100;
}

function expectPlainDestructiveText(classes: string) {
  // At full strength: a `text-destructive/90` would composite the text too.
  expect(classes).toMatch(/(?:^|\s)text-destructive(?=\s|$)/);
}

const light = readTheme(":root");
const dark = readTheme(".dark");
const button = buttonVariants({ variant: "destructive" });
const badge = badgeVariants({ variant: "destructive" });

// --- tests -----------------------------------------------------------------

describe("the contrast model", () => {
  // The theme as it stood when #148's live check ran: production build,
  // Chromium, axe-core `color-contrast`, dialogs measured once their open
  // animation had finished. Literals on purpose — this pins the arithmetic, not
  // whatever globals.css holds today.
  const asMeasured: { light: Theme; dark: Theme } = {
    light: {
      destructive: [0.58, 0.22, 27],
      background: [1, 0, 0],
      card: [1, 0, 0],
      muted: [0.97, 0, 0],
    },
    dark: {
      destructive: [0.704, 0.191, 22.216],
      background: [0.145, 0, 0],
      card: [0.205, 0, 0],
      muted: [0.269, 0, 0],
    },
  };

  it("reproduces axe's live readings from #148", () => {
    const l = backdrops(asMeasured.light);
    const d = backdrops(asMeasured.dark);
    expect(tintRatio(asMeasured.light, 0.1, l.footer)).toBeCloseTo(3.93, 1);
    expect(tintRatio(asMeasured.light, 0.1, l.card)).toBeCloseTo(4.09, 1);
    expect(tintRatio(asMeasured.dark, 0.2, d.footer)).toBeCloseTo(4.59, 1);
    expect(tintRatio(asMeasured.dark, 0.2, d.card)).toBeCloseTo(4.66, 1);
  });

  it("reproduces the colours axe reported, not just the ratios", () => {
    expect(oklchToRgb(asMeasured.light.destructive)).toEqual([0xdf, 0x22, 0x25]);
    expect(oklchToRgb(asMeasured.dark.destructive)).toEqual([0xff, 0x64, 0x67]);
    const d = backdrops(asMeasured.dark);
    const red = oklchToRgb(asMeasured.dark.destructive);
    expect(over(red, 0.2, d.footer)).toEqual([0x46, 0x27, 0x28]);
    expect(over(red, 0.2, d.card)).toEqual([0x45, 0x26, 0x27]);
  });
});

describe("destructive Button contrast (Issue #362)", () => {
  it("paints full-strength destructive text on a destructive tint", () => {
    expectPlainDestructiveText(button);
  });

  describe("light mode", () => {
    const { footer, card } = backdrops(light);

    it("passes AA at rest in a dialog footer (every confirm button)", () => {
      expect(tintRatio(light, tintAlpha(button, ""), footer)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("passes AA at rest on a card (the Delete Account trigger)", () => {
      expect(tintRatio(light, tintAlpha(button, ""), card)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    // Hover is the state the text is in at the moment someone clicks Delete.
    it("passes AA on hover in a dialog footer", () => {
      expect(tintRatio(light, tintAlpha(button, "hover:"), footer)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    });

    it("passes AA on hover on a card", () => {
      expect(tintRatio(light, tintAlpha(button, "hover:"), card)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  });

  describe("dark mode", () => {
    const { footer, card } = backdrops(dark);

    it("passes AA at rest in a dialog footer", () => {
      expect(tintRatio(dark, tintAlpha(button, "dark:"), footer)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("passes AA at rest on a card", () => {
      expect(tintRatio(dark, tintAlpha(button, "dark:"), card)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    // `dark:hover:bg-destructive/30` measures about 3.8:1 and fails, and did
    // before #362. No token value fixes it without turning every dark-mode
    // error colour salmon-pink, so it needs a hover design decision of its own:
    // Issue #405.
    it.todo("passes AA on hover (dark:hover:bg-destructive/30) — Issue #405");
  });
});

describe("destructive Badge contrast (Issue #362)", () => {
  // Same tint-on-tint pattern at text-xs. Only the "Breaking migration" badge on
  // /settings/about uses it, and no release has declared one yet, so this gate
  // is the only thing that measures it.
  it("paints full-strength destructive text on a destructive tint", () => {
    expectPlainDestructiveText(badge);
  });

  it("passes AA on a card in light mode", () => {
    expect(tintRatio(light, tintAlpha(badge, ""), backdrops(light).card)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it("passes AA on a card in dark mode", () => {
    expect(
      tintRatio(dark, tintAlpha(badge, "dark:"), backdrops(dark).card),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
