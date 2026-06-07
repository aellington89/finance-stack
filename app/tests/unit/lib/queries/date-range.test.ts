import { describe, it, expect } from "vitest";
import { getDateRangeFromParams } from "@/lib/queries/date-range";

describe("getDateRangeFromParams", () => {
  it("returns parsed dates for a valid ordered range", () => {
    const result = getDateRangeFromParams(
      { dateFrom: "2024-01-01", dateTo: "2024-12-31" },
      { applyDefault: false }
    );
    expect(result).toEqual({ dateFrom: "2024-01-01", dateTo: "2024-12-31" });
  });

  it("no longer swaps an out-of-order range (ordering is enforced upstream)", () => {
    const result = getDateRangeFromParams(
      { dateFrom: "2024-12-31", dateTo: "2024-01-01" },
      { applyDefault: false }
    );
    // Previously this helper swapped the two; it now passes them through as-is.
    expect(result).toEqual({ dateFrom: "2024-12-31", dateTo: "2024-01-01" });
  });

  it("applies the default window when dateFrom is absent", () => {
    const result = getDateRangeFromParams({}, { applyDefault: true, defaultDays: 30 });
    expect(result.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.dateTo).toBeUndefined();
  });

  it("does not apply a default when applyDefault is false", () => {
    const result = getDateRangeFromParams({}, { applyDefault: false });
    expect(result).toEqual({ dateFrom: undefined, dateTo: undefined });
  });

  it("coerces an array param to its first value", () => {
    const result = getDateRangeFromParams(
      { dateFrom: ["2024-03-01", "2024-04-01"] },
      { applyDefault: false }
    );
    expect(result.dateFrom).toBe("2024-03-01");
  });
});
