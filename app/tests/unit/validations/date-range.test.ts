import { describe, it, expect } from "vitest";
import {
  validateDateRange,
  isValidIsoDate,
} from "@/lib/validations/date-range";

describe("validateDateRange", () => {
  it("accepts both params absent", () => {
    const result = validateDateRange({});
    expect(result).toEqual({ ok: true, dateFrom: undefined, dateTo: undefined });
  });

  it("accepts only dateFrom", () => {
    const result = validateDateRange({ dateFrom: "2024-01-01" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dateFrom).toBe("2024-01-01");
      expect(result.dateTo).toBeUndefined();
    }
  });

  it("accepts only dateTo", () => {
    const result = validateDateRange({ dateTo: "2024-01-01" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dateTo).toBe("2024-01-01");
  });

  it("accepts equal dates", () => {
    const result = validateDateRange({
      dateFrom: "2024-06-15",
      dateTo: "2024-06-15",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid ordered range", () => {
    const result = validateDateRange({
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an out-of-order range with a clear message", () => {
    const result = validateDateRange({
      dateFrom: "2024-12-31",
      dateTo: "2024-01-01",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/on or before/i);
    }
  });

  it("does NOT swap an out-of-order range (rejects instead)", () => {
    const result = validateDateRange({
      dateFrom: "2024-12-31",
      dateTo: "2024-01-01",
    });
    expect(result.ok).toBe(false);
  });

  it.each(["2024-1-1", "01/15/2020", "banana", "2024/01/01", "2024-01-01T00:00:00"])(
    "rejects malformed date %s",
    (bad) => {
      const result = validateDateRange({ dateFrom: bad });
      expect(result.ok).toBe(false);
    }
  );

  it.each(["2024-13-01", "2024-00-10", "2024-02-30", "2024-04-31"])(
    "rejects impossible date %s",
    (bad) => {
      const result = validateDateRange({ dateTo: bad });
      expect(result.ok).toBe(false);
    }
  );

  it("coerces an array param to its first value", () => {
    const result = validateDateRange({ dateFrom: ["2024-01-01", "2024-02-02"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dateFrom).toBe("2024-01-01");
  });

  it("treats empty-string params as absent", () => {
    const result = validateDateRange({ dateFrom: "", dateTo: "" });
    expect(result).toEqual({ ok: true, dateFrom: undefined, dateTo: undefined });
  });
});

describe("isValidIsoDate", () => {
  it.each(["2024-01-01", "2020-02-29", "1999-12-31"])(
    "accepts valid date %s",
    (good) => {
      expect(isValidIsoDate(good)).toBe(true);
    }
  );

  it.each([undefined, "", "2024-1-1", "banana", "2024-02-30", "2021-02-29", "2024-13-01"])(
    "rejects invalid value %s",
    (bad) => {
      expect(isValidIsoDate(bad)).toBe(false);
    }
  );
});
