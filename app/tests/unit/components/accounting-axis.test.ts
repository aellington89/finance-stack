import { describe, it, expect } from "vitest";
import {
  makeTickFormatter,
  makeTooltipLabelFormatter,
  formatDotDate,
} from "@/components/charts/accounting-axis";
import type { TimeGrouping } from "@/lib/queries/accounting";

const payload = (date: string | number) => [{ payload: { date: String(date) } }];

describe("formatDotDate", () => {
  it("renders M.D.YYYY without zero padding", () => {
    expect(formatDotDate(new Date(2026, 0, 5))).toBe("1.5.2026");
  });
});

describe("makeTickFormatter", () => {
  it.each([
    ["day", "2026-04-19", "Apr 19"],
    ["month", "2026-04-01", "April 2026"],
    ["year", "2026-01-01", "2026"],
  ] as const)("formats a %s tick", (grouping, input, expected) => {
    expect(makeTickFormatter(grouping)(input)).toBe(expected);
  });

  it("labels a week by the last day of the period, not the first", () => {
    // The bucket is keyed by its start date; showing the start would make a
    // week look like it ended six days before it did.
    expect(makeTickFormatter("week")("2026-04-13")).toBe("Apr 19");
  });

  it("formats a quarter as Q<n> <year>", () => {
    expect(makeTickFormatter("quarter")("2026-04-01")).toBe("Q2 2026");
  });

  it.each([
    ["day_of_week", "0", "Sun"],
    ["day_of_week", "6", "Sat"],
    ["month_of_year", "1", "Jan"],
    ["month_of_year", "12", "Dec"],
    ["quarter_of_year", "3", "Q3"],
  ] as const)("formats the cyclical grouping %s value %s", (grouping, input, expected) => {
    expect(makeTickFormatter(grouping)(input)).toBe(expected);
  });

  it("passes an out-of-range cyclical value through rather than showing undefined", () => {
    expect(makeTickFormatter("day_of_week")("9")).toBe("9");
    expect(makeTickFormatter("month_of_year")("13")).toBe("13");
  });

  it.each(["day_of_month", "day_of_year", "week_of_year"] as const)(
    "leaves the bare ordinal grouping %s unformatted",
    (grouping) => {
      expect(makeTickFormatter(grouping as TimeGrouping)("17")).toBe("17");
    }
  );
});

describe("makeTooltipLabelFormatter", () => {
  it.each([
    ["day", "2026-04-19", "Apr 19, 2026"],
    ["month", "2026-04-01", "April 2026"],
    ["year", "2026-01-01", "2026"],
    ["quarter", "2026-04-01", "Q2 2026"],
  ] as const)("formats a %s label", (grouping, date, expected) => {
    expect(makeTooltipLabelFormatter(grouping)(null, payload(date))).toBe(expected);
  });

  it("shows a week as its full inclusive date range", () => {
    expect(makeTooltipLabelFormatter("week")(null, payload("2026-04-13"))).toBe(
      "4.13.2026 - 4.19.2026"
    );
  });

  it.each([
    ["day_of_week", 0, "Sun"],
    ["month_of_year", 12, "Dec"],
    ["quarter_of_year", 4, "Q4"],
  ] as const)("formats the cyclical grouping %s", (grouping, date, expected) => {
    expect(makeTooltipLabelFormatter(grouping)(null, payload(date))).toBe(expected);
  });

  // recharts calls the label formatter before data arrives, so every arm has
  // to survive an absent payload rather than throwing inside a render.
  it.each([
    "day",
    "week",
    "month",
    "quarter",
    "year",
  ] as const)("returns empty rather than throwing on an empty %s payload", (grouping) => {
    expect(makeTooltipLabelFormatter(grouping)(null, [])).toBe("");
    expect(makeTooltipLabelFormatter(grouping)(null, [{}])).toBe("");
  });

  it("falls through to the raw value for an ordinal grouping", () => {
    expect(makeTooltipLabelFormatter("day_of_month")(null, payload(17))).toBe("17");
  });

  it("renders an absent ordinal payload as empty, not 'undefined'", () => {
    expect(makeTooltipLabelFormatter("day_of_month")(null, [])).toBe("");
  });
});
