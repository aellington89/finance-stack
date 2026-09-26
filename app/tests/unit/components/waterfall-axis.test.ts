import { describe, it, expect } from "vitest";
import {
  buildWaterfallAxis,
  type WaterfallAxis,
  type WaterfallAxisBar,
} from "@/components/charts/waterfall-axis";
import { buildDebtWaterfallBars } from "@/components/charts/debt-waterfall-bars";
import { buildWaterfallBars } from "@/components/charts/waterfall-bars";
import { formatCurrencyCompact } from "@/lib/format/financial";

// A debt fixture is a start balance plus the three movements. End is derived
// from them, so every fixture balances exactly as getDebtWaterfall's output
// does. The bars are built by the real builder, so the tests see exactly what
// the chart would draw.
function debtBars(
  startBalance: number,
  payments: number,
  interestAccrued: number,
  other = 0
) {
  return buildDebtWaterfallBars({
    startBalance,
    payments,
    interestAccrued,
    other,
    endBalance: startBalance + payments + interestAccrued + other,
  });
}

// The bars use only each category's `change`. The per-category balances are
// placeholders.
function netWorthBars(startNetWorth: number, changes: number[]) {
  return buildWaterfallBars({
    startNetWorth,
    endNetWorth: changes.reduce((sum, c) => sum + c, startNetWorth),
    categories: changes.map((change, i) => ({
      categoryId: i + 1,
      categoryName: `Category ${i + 1}`,
      startBalance: 0,
      endBalance: change,
      change,
    })),
  });
}

function zoom(bars: WaterfallAxisBar[]): WaterfallAxis {
  const axis = buildWaterfallAxis(bars);
  if (!axis) throw new Error("expected a zoomed axis");
  return axis;
}

// A bar's height as a share of the plot.
function share(bar: WaterfallAxisBar, { domain: [min, max] }: WaterfallAxis) {
  return bar.value / (max - min);
}

// Every fixture that zooms. The property tests at the bottom run over all of
// them.
const ZOOMED: [string, WaterfallAxisBar[]][] = [
  ["the issue's example", debtBars(-250_000, 3_000, -1_000)],
  ["a month on a larger balance", debtBars(-385_000, 6_000, -1_500, 1_000)],
  ["payments overshooting both ends", debtBars(-300_000, 40_000, -10_000, -38_000)],
  ["a liability in credit", debtBars(5_000, 0, 0, 400)],
  ["$30 of interest on $420K", debtBars(-420_000, 0, -30)],
  ["$3K of interest on $1.25M", debtBars(-1_250_000, 0, -3_000)],
  ["a balance under $1K", debtBars(-800, 50, -12)],
  ["a net-worth bridge", netWorthBars(180_000, [-1_500, -9_000, -200, 4_000, 300])],
];

// 1, 2 and 5 × 10^k, covering every step the fixtures above can produce.
const NICE_STEPS = [0, 1, 2, 3, 4, 5, 6].flatMap((k) =>
  [1, 2, 5].map((m) => m * 10 ** k)
);

describe("buildWaterfallAxis: when it keeps the $0-based axis", () => {
  it("keeps it when nothing moved", () => {
    expect(buildWaterfallAxis(debtBars(-5_000, 0, 0))).toBeNull();
    expect(buildWaterfallAxis(netWorthBars(50_000, []))).toBeNull();
  });

  it("keeps it when the balance crosses $0", () => {
    // Paid off and into credit. The bridge already spans the whole $0-based
    // axis, so zooming has nothing to cut away.
    expect(buildWaterfallAxis(debtBars(-500, 700, 0))).toBeNull();
  });

  it("zooms only when that at least doubles the scale of the bars", () => {
    // A $3K paydown of $10K zooms to 5,000 of axis, exactly half the $0-based
    // 10,000.
    expect(zoom(debtBars(-10_000, 3_000, 0)).domain).toEqual([-11_000, -6_000]);
    // A $4K paydown is already 40% of that axis. Padding and rounding would
    // widen the zoomed axis to 6,000, only 1.7×, so both pillars would be cut
    // off for almost no gain.
    expect(buildWaterfallAxis(debtBars(-10_000, 4_000, 0))).toBeNull();
  });

  it("keeps it when whole-dollar ticks cannot magnify a tiny balance", () => {
    // Zoomed, a $1.20 debt would need an axis of [-2, 0]. That is wider than
    // its own $0-based extent, so the rule declines. The same arithmetic means
    // a zoomed axis can never reach $0: an axis that did would be at least as
    // wide as the $0-based one it replaces.
    expect(buildWaterfallAxis(debtBars(-1.2, 0.5, 0))).toBeNull();
  });
});

describe("buildWaterfallAxis: zooming to the bridge", () => {
  it("makes the issue's change bars readable (acceptance criterion 1)", () => {
    // Issue #251's own numbers: a $250K balance moved by $3K of payments and
    // $1K of interest. On the $0-based axis those bars were 1.2% and 0.4% of
    // the plot.
    const bars = debtBars(-250_000, 3_000, -1_000);
    const axis = zoom(bars);

    expect(axis).toEqual({
      domain: [-251_000, -246_000],
      ticks: [-251_000, -250_000, -249_000, -248_000, -247_000, -246_000],
    });
    expect(share(bars.find((b) => b.name === "Payments")!, axis)).toBeCloseTo(0.6);
    expect(share(bars.find((b) => b.name === "Interest")!, axis)).toBeCloseTo(0.2);
  });

  it("zooms a month of movement on a larger balance", () => {
    const bars = debtBars(-385_000, 6_000, -1_500, 1_000);
    const axis = zoom(bars);

    expect(axis.domain).toEqual([-386_000, -378_000]);
    expect(axis.ticks[1] - axis.ticks[0]).toBe(2_000);
    expect(share(bars.find((b) => b.name === "Payments")!, axis)).toBeCloseTo(0.75);
  });

  it("keeps a bar that overshoots both ends inside the axis", () => {
    // Payments lift the balance $40K above Start, and interest and Other then
    // take it $48K back down. An axis bracketing only the two ends, as first
    // suggested in the issue, would clip the Payments bar at about -$299K.
    const axis = zoom(debtBars(-300_000, 40_000, -10_000, -38_000));

    expect(axis.domain).toEqual([-320_000, -240_000]);
    expect(axis.domain[1]).toBeGreaterThanOrEqual(-300_000 + 40_000);
  });

  it("zooms a positive balance, clipping the pillars at the bottom", () => {
    // A liability in credit. Its Start and End rise from $0, which sits below
    // this axis.
    expect(zoom(debtBars(5_000, 0, 0, 400)).domain).toEqual([4_900, 5_500]);
  });

  it("zooms the Net Worth waterfall the same way", () => {
    const axis = zoom(
      netWorthBars(180_000, [-1_500, -9_000, -200, 4_000, 300])
    );

    expect(axis.domain).toEqual([165_000, 185_000]);
    expect(axis.ticks[1] - axis.ticks[0]).toBe(5_000);
  });
});

describe("buildWaterfallAxis: tick labels", () => {
  it("coarsens the step so no two ticks share a compact label", () => {
    // formatCurrencyCompact prints one decimal of the unit. Without the floor,
    // $30 of interest on $420K would get a $10 step, and every tick would
    // print as -$420.0K.
    expect(zoom(debtBars(-420_000, 0, -30)).ticks).toEqual([
      -420_100, -420_000, -419_900,
    ]);
    // The same limit in millions is $100K. That leaves $3K of interest on
    // $1.25M only two gridlines, though the scale is still 12.5× the $0-based
    // one.
    expect(zoom(debtBars(-1_250_000, 0, -3_000)).ticks).toEqual([
      -1_300_000, -1_200_000,
    ]);
    // Under $1K the formatter drops the unit, and whole dollars are the floor.
    expect(zoom(debtBars(-800, 50, -12)).ticks).toEqual([
      -820, -800, -780, -760, -740,
    ]);
  });
});

describe.each(ZOOMED)("buildWaterfallAxis: invariants for %s", (_, bars) => {
  const axis = zoom(bars);
  const [min, max] = axis.domain;

  it("keeps every change bar and the Start and End levels inside the axis", () => {
    for (const bar of bars) {
      const edges =
        bar.type === "start" || bar.type === "end"
          ? [bar.displayValue]
          : [bar.base, bar.base + bar.value];
      for (const edge of edges) {
        expect(edge).toBeGreaterThanOrEqual(min);
        expect(edge).toBeLessThanOrEqual(max);
      }
    }
  });

  it("excludes $0, so only the Start and End pillars are truncated", () => {
    expect(min > 0 || max < 0).toBe(true);
  });

  it("puts ticks on an even 1-2-5 ladder from one edge to the other", () => {
    const step = axis.ticks[1] - axis.ticks[0];

    expect(NICE_STEPS).toContain(step);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(2);
    expect(axis.ticks.length).toBeLessThanOrEqual(7);
    axis.ticks.forEach((tick, i) => expect(tick).toBe(min + i * step));
    expect(axis.ticks.at(-1)).toBe(max);
  });

  it("never prints the same tick label twice", () => {
    const labels = axis.ticks.map(formatCurrencyCompact);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
