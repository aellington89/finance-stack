/**
 * Y-axis for the two waterfall charts. Added by Issue #251.
 *
 * Both bar builders draw Start and End as bars from $0 (`base:
 * Math.min(0, balance)`), so on an unconstrained axis the whole balance sets
 * the scale. A period's movement is typically a few thousand dollars against a
 * balance in the hundreds of thousands, which leaves the change bars — the
 * point of a waterfall — 1–2% tall. When the balance dwarfs the bridge like
 * that, this zooms the axis to the bridge, and Start and End are clipped at the
 * edge of the plot.
 *
 * Three facts about recharts 3 decide the shape of the result. All three were
 * read from its source, not assumed:
 *
 *   - A plain `domain` cannot zoom. Bars stack with `stackOffset: 'none'`, so
 *     every stack starts at 0 (the transparent `base` bar runs from 0 to
 *     `base`), and `extendDomain()` widens a user domain until it contains the
 *     data. Only `allowDataOverflow` stops that, and it is also what clips the
 *     bars to the plot. `"dataMin - x"` and function domains cannot help
 *     either, because the 0 floor is inside the data extent they are given.
 *   - On a fixed domain, recharts starts its ticks at the domain's raw minimum.
 *     For the issue's example that would be -$250,300. So the ticks are passed
 *     explicitly.
 *   - An `undefined` `domain` or `ticks` prop falls back to recharts' default.
 *     A `null` result therefore renders the axis exactly as it was before #251.
 */

// Headroom above and below the bridge, as a fraction of its span.
const PADDING = 0.1;

// About how many gridline intervals the zoomed axis should have.
const TARGET_INTERVALS = 5;

// Zoom only when doing so at least doubles the scale of the bars. That test is
// made on the axis as it will be drawn, padding and rounding included: it may
// span at most half the $0-based extent. Short of 2×, the bars can already be
// read, and cutting off Start and End would cost more than it gains. A
// side effect is that a zoomed axis can never reach $0.
const MIN_MAGNIFICATION = 2;

/**
 * The fields that `WaterfallBar` and `DebtWaterfallBar` share. Typing by shape
 * means neither bars module has to import the other.
 */
export interface WaterfallAxisBar {
  type: string;
  base: number;
  value: number;
  displayValue: number;
}

export interface WaterfallAxis {
  domain: [number, number];
  ticks: number[];
}

/**
 * The smallest tick step that `formatCurrencyCompact` can label without
 * repeating itself at magnitude `m`. It prints one decimal of the compact unit,
 * so -250,450 and -250,500 both print as "-$250.5K". A step finer than a tenth
 * of the unit would therefore repeat labels. Update this if that formatter
 * changes.
 *
 * Rounding an edge outward cannot push the axis into the next unit's
 * resolution: 10^3 and 10^6 are multiples of every step below them.
 */
function labelResolution(m: number): number {
  if (m >= 1e6) return 1e5;
  if (m >= 1e3) return 1e2;
  return 1;
}

/** The smallest 1, 2 or 5 × 10^k that is at least `rough`. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  return power * ([1, 2, 5].find((m) => m * power >= rough) ?? 10);
}

/**
 * The zoomed Y-axis for a waterfall's bars. Returns null when the chart should
 * keep its $0-based axis. That happens when nothing moved, and when zooming
 * would not at least double the scale of the bars. The second case covers
 * every bridge that crosses $0 and every bridge already big enough to read.
 */
export function buildWaterfallAxis(
  bars: readonly WaterfallAxisBar[]
): WaterfallAxis | null {
  // Collect every level the bridge passes through, not only the two ends. A
  // period's payments can take the running balance well past both Start and
  // End before interest and Other bring it back, and an axis that bracketed
  // only the ends would clip that bar.
  const levels = bars.flatMap((bar) =>
    bar.type === "start" || bar.type === "end"
      ? [bar.displayValue]
      : [bar.base, bar.base + bar.value]
  );
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const span = hi - lo;

  // Nothing moved, so there is no bridge to zoom to. This case has to be caught
  // here: otherwise niceStep() below would be handed log10(0).
  if (span === 0) return null;

  const pad = span * PADDING;
  const step = Math.max(
    niceStep((span + 2 * pad) / TARGET_INTERVALS),
    labelResolution(Math.max(Math.abs(lo - pad), Math.abs(hi + pad)))
  );
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;

  if ((max - min) * MIN_MAGNIFICATION > Math.max(hi, 0) - Math.min(lo, 0)) {
    return null;
  }

  return {
    domain: [min, max],
    ticks: Array.from(
      { length: Math.round((max - min) / step) + 1 },
      (_, i) => min + i * step
    ),
  };
}
