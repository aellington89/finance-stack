import { describe, it, expect } from "vitest";
import {
  signedCurrency,
  signedPercent,
  amountColorClass,
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
