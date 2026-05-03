import { describe, it, expect } from "vitest";
import { buildDebtWaterfallBars } from "@/components/charts/debt-waterfall-chart";
import type { DebtWaterfallData } from "@/lib/queries/liabilities-drilldown";

describe("buildDebtWaterfallBars", () => {
  it("produces start, payments, interest, end bars (other dropped when zero)", () => {
    const data: DebtWaterfallData = {
      startBalance: -10000,
      endBalance: -8800, // start + payments(2000) + interest(-800) + other(0)
      payments: 2000,
      interestAccrued: -800,
      other: 0,
    };
    const bars = buildDebtWaterfallBars(data);
    const names = bars.map((b) => b.name);
    expect(names).toEqual(["Start", "Payments", "Interest", "End"]);
  });

  it("skips zero-delta change bars but keeps start/end", () => {
    const data: DebtWaterfallData = {
      startBalance: -5000,
      endBalance: -5000,
      payments: 0,
      interestAccrued: 0,
      other: 0,
    };
    const bars = buildDebtWaterfallBars(data);
    expect(bars.map((b) => b.name)).toEqual(["Start", "End"]);
  });

  it("colors payments as 'good' (paydown) and interest as 'bad' (added debt)", () => {
    const data: DebtWaterfallData = {
      startBalance: -10000,
      endBalance: -9000,
      payments: 1500,
      interestAccrued: -500,
      other: 0,
    };
    const bars = buildDebtWaterfallBars(data);
    const payments = bars.find((b) => b.name === "Payments");
    const interest = bars.find((b) => b.name === "Interest");
    expect(payments?.type).toBe("good");
    expect(interest?.type).toBe("bad");
  });

  it("colors 'other' by sign — positive = good, negative = bad", () => {
    const positiveOther: DebtWaterfallData = {
      startBalance: -10000,
      endBalance: -9500,
      payments: 0,
      interestAccrued: 0,
      other: 500,
    };
    const negativeOther: DebtWaterfallData = {
      startBalance: -10000,
      endBalance: -10500,
      payments: 0,
      interestAccrued: 0,
      other: -500,
    };
    expect(
      buildDebtWaterfallBars(positiveOther).find((b) => b.name === "Other")
        ?.type
    ).toBe("good");
    expect(
      buildDebtWaterfallBars(negativeOther).find((b) => b.name === "Other")
        ?.type
    ).toBe("bad");
  });

  it("reconciles the bridge: running total + change-bar deltas = end balance", () => {
    const data: DebtWaterfallData = {
      startBalance: -12000,
      endBalance: -10300, // start + 2400 - 500 - 200
      payments: 2400,
      interestAccrued: -500,
      other: -200,
    };
    const bars = buildDebtWaterfallBars(data);
    const startBar = bars.find((b) => b.name === "Start")!;
    const endBar = bars.find((b) => b.name === "End")!;
    // displayValue carries the signed value; sum of deltas + start = end.
    const deltaSum = bars
      .filter((b) => b.type === "good" || b.type === "bad")
      .reduce((s, b) => s + b.displayValue, 0);
    expect(startBar.displayValue + deltaSum).toBe(endBar.displayValue);
  });

  it("renders bars with non-negative `value` magnitudes (Recharts requires ≥ 0)", () => {
    const data: DebtWaterfallData = {
      startBalance: -8000,
      endBalance: -7500,
      payments: 700,
      interestAccrued: -200,
      other: 0,
    };
    for (const bar of buildDebtWaterfallBars(data)) {
      expect(bar.value).toBeGreaterThanOrEqual(0);
    }
  });
});
