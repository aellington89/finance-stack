import { describe, it, expect } from "vitest";
import { formatPercentChange } from "@/components/dashboard/liability-performance-table";

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
