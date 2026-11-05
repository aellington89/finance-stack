import { describe, it, expect } from "vitest";
import { round2, pct, pctOrNull } from "@/lib/queries/_percent";

describe("round2", () => {
  it("rounds to two decimal places", () => {
    expect(round2(12.344)).toBe(12.34);
    expect(round2(12.346)).toBe(12.35);
    expect(round2(-12.346)).toBe(-12.35);
    expect(round2(7)).toBe(7);
  });
});

describe("pct", () => {
  it("expresses num as a percent of den, rounded to 2 dp", () => {
    expect(pct(1, 3)).toBe(33.33);
    expect(pct(2, 3)).toBe(66.67);
    expect(pct(50, 200)).toBe(25);
  });

  it("returns 0 for a zero denominator — a share of nothing", () => {
    expect(pct(100, 0)).toBe(0);
    expect(pct(0, 0)).toBe(0);
  });

  it("carries the sign of the quotient", () => {
    expect(pct(-50, 200)).toBe(-25);
    expect(pct(50, -200)).toBe(-25);
    expect(pct(-50, -200)).toBe(25);
  });

  it("exceeds 100 when the part outgrows the whole", () => {
    // A signed share: one contributor can be more than the net it feeds.
    expect(pct(150, 100)).toBe(150);
  });
});

describe("pctOrNull", () => {
  it("matches pct for a non-zero denominator", () => {
    expect(pctOrNull(1, 3)).toBe(33.33);
    expect(pctOrNull(-50, 200)).toBe(-25);
    expect(pctOrNull(50, -200)).toBe(-25);
  });

  it("returns null for a zero denominator — an undefined rate of change", () => {
    expect(pctOrNull(100, 0)).toBeNull();
    expect(pctOrNull(0, 0)).toBeNull();
  });

  it("returns 0, not null, when nothing changed against a real start", () => {
    expect(pctOrNull(0, 500)).toBe(0);
  });
});
