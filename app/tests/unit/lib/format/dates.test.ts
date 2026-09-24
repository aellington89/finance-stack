import { describe, it, expect } from "vitest";
import { parseChartDate, formatAxisDate } from "@/lib/format/dates";

describe("parseChartDate", () => {
  // The whole reason the helper exists: `new Date("2026-04-19")` is parsed as
  // UTC midnight and renders as the 18th for any viewer west of Greenwich.
  it("parses a date column as local midnight, not UTC", () => {
    const d = parseChartDate("2026-04-19");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(19);
    expect(d.getHours()).toBe(0);
  });

  it("does not drift across a month boundary", () => {
    const d = parseChartDate("2026-01-01");
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });
});

describe("formatAxisDate", () => {
  it("renders the short axis label", () => {
    expect(formatAxisDate("2026-04-19")).toBe("Apr 19");
  });

  it("does not zero-pad the day", () => {
    expect(formatAxisDate("2026-04-01")).toBe("Apr 1");
  });

  it("reports the stored day rather than the UTC-shifted one", () => {
    expect(formatAxisDate("2026-01-01")).toBe("Jan 1");
  });
});
