import { describe, it, expect } from "vitest";
import {
  signedCurrency,
  signedPercent,
  amountColorClass,
  formatPercentChange,
  formatCurrency,
  formatCurrencyCompact,
} from "@/lib/format/financial";

describe("signedCurrency", () => {
  it("prefixes positive values with '+'", () => {
    expect(signedCurrency(1234.56)).toBe("+$1,234.56");
  });

  it("prefixes negative values with '-' (single dash, not double)", () => {
    // Math.abs() is applied first, so we never get "--$X"
    expect(signedCurrency(-1234.56)).toBe("-$1,234.56");
  });

  it("returns zero without a sign", () => {
    expect(signedCurrency(0)).toBe("$0.00");
  });
});

describe("signedPercent", () => {
  it("prefixes positive values with '+'", () => {
    expect(signedPercent(12.34)).toBe("+12.34%");
  });

  it("prefixes negative values with '-'", () => {
    expect(signedPercent(-12.34)).toBe("-12.34%");
  });

  it("returns zero with two decimals and no sign", () => {
    expect(signedPercent(0)).toBe("0.00%");
  });

  it("rounds to two decimal places", () => {
    expect(signedPercent(12.3456)).toBe("+12.35%");
  });
});

describe("amountColorClass", () => {
  it("returns green for positive values", () => {
    expect(amountColorClass(1)).toContain("green");
  });

  it("returns red for negative values", () => {
    expect(amountColorClass(-1)).toContain("red");
  });

  it("returns an empty class for zero", () => {
    expect(amountColorClass(0)).toBe("");
  });
});

describe("formatPercentChange", () => {
  it("renders an em-dash when start balance was zero (null input)", () => {
    expect(formatPercentChange(null)).toBe("—");
  });

  it("delegates to signedPercent for finite values", () => {
    expect(formatPercentChange(12.34)).toBe("+12.34%");
    expect(formatPercentChange(-5)).toBe("-5.00%");
    expect(formatPercentChange(0)).toBe("0.00%");
  });
});

describe("formatCurrency", () => {
  it("always shows exactly two decimals", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(1234.567)).toBe("$1,234.57");
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("renders a negative with a leading minus, not parentheses", () => {
    expect(formatCurrency(-1234.56)).toBe("-$1,234.56");
  });
});

describe("formatCurrencyCompact", () => {
  it("abbreviates magnitudes for axis labels", () => {
    expect(formatCurrencyCompact(1200)).toBe("$1.2K");
    expect(formatCurrencyCompact(1_500_000)).toBe("$1.5M");
  });

  // Below 1000 compact notation still emits the one fraction digit that
  // maximumFractionDigits allows, so small axis ticks read "$12.0" rather than
  // "$12". Pinned as the behaviour that shipped, not endorsed — every existing
  // caller was byte-identical to this before #296 consolidated them, so the
  // refactor had to preserve it exactly.
  it("emits one fraction digit below the compaction threshold", () => {
    expect(formatCurrencyCompact(12)).toBe("$12.0");
    expect(formatCurrencyCompact(999)).toBe("$999.0");
  });

  it("carries the sign", () => {
    expect(formatCurrencyCompact(-2400)).toBe("-$2.4K");
  });
});
