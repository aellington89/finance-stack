import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CADENCES,
  addMonthsToDate,
  cadenceUnit,
  countOccurrencesThrough,
  describeSchedule,
  dueOccurrences,
  isOccurrence,
  isPastEnd,
  nextOccurrenceOnOrAfter,
  nextOccurrences,
  occurrenceDate,
  occurrencesBetween,
  type Schedule,
} from "@/lib/recurring/schedule";

const sched = (overrides: Partial<Schedule> = {}): Schedule => ({
  cadence: "monthly",
  every: 1,
  anchorDate: "2026-01-31",
  endDate: null,
  ...overrides,
});

const first = (s: Schedule, n: number) => Array.from({ length: n }, (_, k) => occurrenceDate(s, k));

describe("occurrenceDate", () => {
  it("is the anchor at k = 0 for every cadence", () => {
    for (const cadence of CADENCES) {
      expect(occurrenceDate(sched({ cadence, anchorDate: "2026-03-14" }), 0)).toBe("2026-03-14");
    }
  });

  it("steps daily by N days", () => {
    expect(first(sched({ cadence: "daily", anchorDate: "2026-12-30" }), 4)).toEqual([
      "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02",
    ]);
    expect(first(sched({ cadence: "daily", every: 3, anchorDate: "2026-02-26" }), 3)).toEqual([
      "2026-02-26", "2026-03-01", "2026-03-04",
    ]);
  });

  it("steps weekly by 7·N days, across the year end and a DST change", () => {
    // 2026-03-08 is the US spring-forward Sunday; UTC arithmetic doesn't see it.
    expect(first(sched({ cadence: "weekly", anchorDate: "2026-03-06" }), 3)).toEqual([
      "2026-03-06", "2026-03-13", "2026-03-20",
    ]);
    // Biweekly pay across the year end.
    expect(first(sched({ cadence: "weekly", every: 2, anchorDate: "2026-12-18" }), 3)).toEqual([
      "2026-12-18", "2027-01-01", "2027-01-15",
    ]);
  });

  it("clamps a monthly 31st to the month's last day and returns to the 31st", () => {
    expect(first(sched({ anchorDate: "2026-01-31" }), 13)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30",
      "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31",
      "2027-01-31",
    ]);
  });

  it("clamps to Feb 29 in a leap year", () => {
    expect(first(sched({ anchorDate: "2028-01-30" }), 3)).toEqual(["2028-01-30", "2028-02-29", "2028-03-30"]);
    expect(first(sched({ anchorDate: "2028-01-31" }), 3)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("keeps years 0–99 in their own century", () => {
    // Date.UTC reads them as 1900–1999; 1900 wasn't a leap year, but year 0 was.
    expect(first(sched({ cadence: "daily", anchorDate: "0050-03-01" }), 2)).toEqual(["0050-03-01", "0050-03-02"]);
    expect(occurrenceDate(sched({ cadence: "yearly", anchorDate: "0000-02-29" }), 1)).toBe("0001-02-28");
  });

  it("steps every N months (quarterly)", () => {
    expect(first(sched({ every: 3, anchorDate: "2026-11-30" }), 4)).toEqual([
      "2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30",
    ]);
  });

  it("keeps a yearly Feb 29 on Feb 28 in common years and Feb 29 in leap years", () => {
    expect(first(sched({ cadence: "yearly", anchorDate: "2028-02-29" }), 5)).toEqual([
      "2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29",
    ]);
  });

  it("steps every N years", () => {
    expect(first(sched({ cadence: "yearly", every: 2, anchorDate: "2026-07-04" }), 3)).toEqual([
      "2026-07-04", "2028-07-04", "2030-07-04",
    ]);
  });

  it("ignores the end date", () => {
    expect(occurrenceDate(sched({ anchorDate: "2026-01-15", endDate: "2026-01-20" }), 1)).toBe("2026-02-15");
  });

  it("refuses a negative or fractional index", () => {
    expect(() => occurrenceDate(sched(), -1)).toThrow(RangeError);
    expect(() => occurrenceDate(sched(), 1.5)).toThrow(RangeError);
  });

  it("refuses a malformed schedule loudly", () => {
    expect(() => occurrenceDate(sched({ anchorDate: "2026-02-30" }), 0)).toThrow(/calendar date/);
    expect(() => occurrenceDate(sched({ anchorDate: "26-1-1" }), 0)).toThrow(/YYYY-MM-DD/);
    expect(() => occurrenceDate(sched({ every: 0 }), 0)).toThrow(/Interval/);
    expect(() => occurrenceDate(sched({ every: 100 }), 0)).toThrow(/Interval/);
    expect(() => occurrenceDate(sched({ every: 1.5 }), 0)).toThrow(/Interval/);
    expect(() => occurrenceDate(sched({ cadence: "hourly" as never }), 0)).toThrow(/cadence/);
    expect(() => occurrenceDate(sched({ endDate: "2026-13-01" }), 0)).toThrow(/calendar date/);
  });
});

describe("isOccurrence / nextOccurrenceOnOrAfter", () => {
  const monthly31 = sched({ anchorDate: "2026-01-31" });

  it("recognizes clamped dates as occurrences", () => {
    expect(isOccurrence(monthly31, "2026-02-28")).toBe(true);
    expect(isOccurrence(monthly31, "2026-03-31")).toBe(true);
    expect(isOccurrence(monthly31, "2026-03-28")).toBe(false);
    expect(isOccurrence(monthly31, "2025-12-31")).toBe(false);
  });

  it("returns the date itself when it is an occurrence", () => {
    expect(nextOccurrenceOnOrAfter(monthly31, "2026-04-30")).toBe("2026-04-30");
  });

  it("rolls forward to the next occurrence otherwise", () => {
    expect(nextOccurrenceOnOrAfter(monthly31, "2026-03-01")).toBe("2026-03-31");
    expect(nextOccurrenceOnOrAfter(monthly31, "2026-04-01")).toBe("2026-04-30");
    expect(nextOccurrenceOnOrAfter(sched({ cadence: "weekly", every: 2, anchorDate: "2026-11-06" }), "2026-11-14"))
      .toBe("2026-11-20");
    expect(nextOccurrenceOnOrAfter(sched({ cadence: "daily", every: 5, anchorDate: "2026-11-01" }), "2026-11-12"))
      .toBe("2026-11-16");
    expect(nextOccurrenceOnOrAfter(sched({ cadence: "yearly", anchorDate: "2024-02-29" }), "2025-03-01"))
      .toBe("2026-02-28");
  });

  it("returns the anchor for any date on or before it", () => {
    expect(nextOccurrenceOnOrAfter(monthly31, "2020-06-01")).toBe("2026-01-31");
    expect(nextOccurrenceOnOrAfter(sched({ cadence: "daily", anchorDate: "2026-11-20" }), "2026-11-01"))
      .toBe("2026-11-20");
  });

  it("handles a month-difference candidate in a later month than the date", () => {
    // Quarterly from Jan 15: Apr 20 is past Apr 15, so the answer is Jul 15.
    expect(nextOccurrenceOnOrAfter(sched({ every: 3, anchorDate: "2026-01-15" }), "2026-04-20")).toBe("2026-07-15");
    // …and May 1 is between quarters.
    expect(nextOccurrenceOnOrAfter(sched({ every: 3, anchorDate: "2026-01-15" }), "2026-05-01")).toBe("2026-07-15");
  });
});

describe("dueOccurrences", () => {
  it("returns every occurrence from next through today, and the next one after", () => {
    const s = sched({ cadence: "daily", anchorDate: "2026-11-11" });
    expect(dueOccurrences(s, "2026-11-11", "2026-11-14", 400)).toEqual({
      dates: ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"],
      next: "2026-11-15",
    });
  });

  it("returns nothing when next is after today", () => {
    expect(dueOccurrences(sched({ anchorDate: "2026-12-01" }), "2026-12-01", "2026-11-14", 400)).toEqual({
      dates: [],
      next: "2026-12-01",
    });
  });

  it("starts from next, not from the anchor", () => {
    const s = sched({ anchorDate: "2026-01-31" });
    expect(dueOccurrences(s, "2026-09-30", "2026-11-14", 400)).toEqual({
      dates: ["2026-09-30", "2026-10-31"],
      next: "2026-11-30",
    });
  });

  it("stops at the cap and leaves next due", () => {
    const s = sched({ cadence: "daily", anchorDate: "2026-11-01" });
    const result = dueOccurrences(s, "2026-11-01", "2026-11-14", 3);
    expect(result).toEqual({ dates: ["2026-11-01", "2026-11-02", "2026-11-03"], next: "2026-11-04" });
    expect(result.next <= "2026-11-14").toBe(true);
  });

  it("includes the end date and stops after it", () => {
    const s = sched({ cadence: "weekly", anchorDate: "2026-10-01", endDate: "2026-10-15" });
    expect(dueOccurrences(s, "2026-10-01", "2026-11-14", 400)).toEqual({
      dates: ["2026-10-01", "2026-10-08", "2026-10-15"],
      next: "2026-10-22",
    });
  });

  it("returns nothing for an ended template", () => {
    const s = sched({ cadence: "weekly", anchorDate: "2026-10-01", endDate: "2026-10-15" });
    expect(dueOccurrences(s, "2026-10-22", "2026-11-14", 400)).toEqual({ dates: [], next: "2026-10-22" });
  });

  it("refuses a next date that is not an occurrence of the schedule", () => {
    expect(() => dueOccurrences(sched({ anchorDate: "2026-01-31" }), "2026-03-28", "2026-11-14", 400))
      .toThrow(/not an occurrence/);
  });

  it("refuses a cap below 1 and a malformed today", () => {
    expect(() => dueOccurrences(sched(), "2026-01-31", "2026-11-14", 0)).toThrow(/Cap/);
    expect(() => dueOccurrences(sched(), "2026-01-31", "today", 1)).toThrow(/YYYY-MM-DD/);
  });
});

describe("countOccurrencesThrough", () => {
  it("counts the dates a save would add at once", () => {
    const s = sched({ cadence: "daily", anchorDate: "2026-11-11" });
    expect(countOccurrencesThrough(s, "2026-11-11", "2026-11-14")).toBe(4);
    expect(countOccurrencesThrough(s, "2026-11-11", "2026-11-10")).toBe(0);
  });

  it("stops at the end date", () => {
    const s = sched({ cadence: "daily", anchorDate: "2026-11-11", endDate: "2026-11-12" });
    expect(countOccurrencesThrough(s, "2026-11-11", "2026-11-14")).toBe(2);
  });

  it("counts a year of a daily schedule", () => {
    const s = sched({ cadence: "daily", anchorDate: "2025-11-14" });
    expect(countOccurrencesThrough(s, "2025-11-14", "2026-11-14")).toBe(366);
  });

  it("refuses to walk an absurd range", () => {
    const s = sched({ cadence: "daily", anchorDate: "1900-01-01" });
    expect(() => countOccurrencesThrough(s, "1900-01-01", "2026-11-14")).toThrow(/Too many/);
  });

  it("refuses a next date that is not an occurrence, as dueOccurrences does", () => {
    expect(() => countOccurrencesThrough(sched({ anchorDate: "2026-01-31" }), "2026-03-28", "2026-11-14"))
      .toThrow(/not an occurrence/);
  });
});

describe("nextOccurrences / occurrencesBetween", () => {
  it("lists the next N dates, stopping at the end date", () => {
    expect(nextOccurrences(sched({ anchorDate: "2026-12-01" }), "2026-12-01", 3)).toEqual([
      "2026-12-01", "2027-01-01", "2027-02-01",
    ]);
    expect(nextOccurrences(sched({ anchorDate: "2026-12-01", endDate: "2027-01-15" }), "2026-12-01", 3)).toEqual([
      "2026-12-01", "2027-01-01",
    ]);
    expect(nextOccurrences(sched({ anchorDate: "2026-12-01", endDate: "2026-11-30" }), "2026-12-01", 3)).toEqual([]);
  });

  it("refuses a count that isn't a whole number", () => {
    expect(nextOccurrences(sched({ anchorDate: "2026-12-01" }), "2026-12-01", 0)).toEqual([]);
    expect(() => nextOccurrences(sched({ anchorDate: "2026-12-01" }), "2026-12-01", 2.5)).toThrow(/Count/);
    expect(() => nextOccurrences(sched({ anchorDate: "2026-12-01" }), "2026-12-01", -1)).toThrow(/Count/);
    expect(() => nextOccurrences(sched({ anchorDate: "2026-12-01" }), "2026-12-01", Number.NaN)).toThrow(/Count/);
    expect(() => nextOccurrences(sched({ anchorDate: "2026-12-01" }), "2026-12-01", Infinity)).toThrow(/Count/);
  });

  it("lists every occurrence in an inclusive window", () => {
    const s = sched({ cadence: "weekly", every: 2, anchorDate: "2026-11-06" });
    expect(occurrencesBetween(s, "2026-11-06", "2026-12-18")).toEqual([
      "2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18",
    ]);
    expect(occurrencesBetween(s, "2026-11-07", "2026-11-19")).toEqual([]);
  });

  it("respects the end date inside the window", () => {
    const s = sched({ anchorDate: "2026-01-31", endDate: "2026-04-30" });
    expect(occurrencesBetween(s, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
    ]);
  });

  it("refuses to walk an absurd range", () => {
    expect(() => occurrencesBetween(sched({ cadence: "daily", anchorDate: "1900-01-01" }), "1900-01-01", "2026-11-14"))
      .toThrow(/Too many/);
  });
});

describe("addMonthsToDate", () => {
  it("shifts both ways, clamping the day", () => {
    expect(addMonthsToDate("2026-11-14", -12)).toBe("2025-11-14");
    expect(addMonthsToDate("2028-02-29", -12)).toBe("2027-02-28");
    expect(addMonthsToDate("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsToDate("2026-01-15", 13)).toBe("2027-02-15");
  });

  it("refuses a fractional shift and a malformed date", () => {
    expect(() => addMonthsToDate("2026-11-14", 0.5)).toThrow(RangeError);
    expect(() => addMonthsToDate("2026-11-31", 1)).toThrow(/calendar date/);
  });
});

describe("isPastEnd", () => {
  it("is false with no end, and inclusive of the end date", () => {
    expect(isPastEnd(sched(), "2999-01-01")).toBe(false);
    expect(isPastEnd(sched({ endDate: "2026-11-14" }), "2026-11-14")).toBe(false);
    expect(isPastEnd(sched({ endDate: "2026-11-14" }), "2026-11-15")).toBe(true);
  });
});

describe("describeSchedule / cadenceUnit", () => {
  it.each<[Partial<Schedule>, string]>([
    [{ cadence: "daily" }, "Daily"],
    [{ cadence: "daily", every: 3 }, "Every 3 days"],
    [{ cadence: "weekly", anchorDate: "2026-11-13" }, "Weekly on Friday"],
    [{ cadence: "weekly", every: 2, anchorDate: "2026-11-15" }, "Every 2 weeks on Sunday"],
    [{ cadence: "monthly", anchorDate: "2026-11-01" }, "Monthly on the 1st"],
    [{ cadence: "monthly", anchorDate: "2026-11-02" }, "Monthly on the 2nd"],
    [{ cadence: "monthly", anchorDate: "2026-11-03" }, "Monthly on the 3rd"],
    [{ cadence: "monthly", anchorDate: "2026-11-11" }, "Monthly on the 11th"],
    [{ cadence: "monthly", anchorDate: "2026-11-12" }, "Monthly on the 12th"],
    [{ cadence: "monthly", anchorDate: "2026-11-13" }, "Monthly on the 13th"],
    [{ cadence: "monthly", anchorDate: "2026-11-22" }, "Monthly on the 22nd"],
    [{ cadence: "monthly", anchorDate: "2026-11-28" }, "Monthly on the 28th"],
    [{ cadence: "monthly", anchorDate: "2026-01-31" }, "Monthly on the 31st (or the last day)"],
    [{ cadence: "monthly", every: 3, anchorDate: "2026-11-15" }, "Every 3 months on the 15th"],
    [{ cadence: "monthly", anchorDate: "2026-01-29" }, "Monthly on the 29th (or the last day)"],
    [{ cadence: "monthly", every: 12, anchorDate: "2026-01-31" }, "Every 12 months on the 31st"],
    [{ cadence: "monthly", every: 2, anchorDate: "2026-01-31" }, "Every 2 months on the 31st (or the last day)"],
    [{ cadence: "monthly", every: 12, anchorDate: "2028-02-29" }, "Every 12 months on the 29th (or the last day)"],
    [{ cadence: "yearly", anchorDate: "2026-03-14" }, "Yearly on March 14"],
    [{ cadence: "yearly", anchorDate: "2028-02-29" }, "Yearly on February 29 (February 28 in other years)"],
    [{ cadence: "yearly", every: 2, anchorDate: "2026-07-04" }, "Every 2 years on July 4"],
  ])("%o → %s", (overrides, expected) => {
    expect(describeSchedule(sched(overrides))).toBe(expected);
  });

  it("pluralizes the unit label", () => {
    expect(cadenceUnit("daily", 1)).toBe("day");
    expect(cadenceUnit("weekly", 2)).toBe("weeks");
    expect(cadenceUnit("monthly", 1)).toBe("month");
    expect(cadenceUnit("yearly", 10)).toBe("years");
  });
});

describe("time-zone independence", () => {
  const original = process.env.TZ;
  afterEach(() => {
    // Assigning undefined would store the string "undefined".
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  // Chicago is the deployment's zone; Kiritimati (UTC+14) and Pago Pago
  // (UTC−11) are the extremes, where a local-midnight Date shifts a whole day.
  it.each(["America/Chicago", "Pacific/Kiritimati", "Pacific/Pago_Pago"])("gives the same dates under TZ=%s", (tz) => {
    process.env.TZ = tz;
    expect(first(sched({ anchorDate: "2026-01-31" }), 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(first(sched({ cadence: "weekly", anchorDate: "2026-03-06" }), 2)).toEqual(["2026-03-06", "2026-03-13"]);
    expect(first(sched({ cadence: "daily", anchorDate: "2026-11-01" }), 2)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(describeSchedule(sched({ cadence: "weekly", anchorDate: "2026-11-13" }))).toBe("Weekly on Friday");
  });
});

describe("CADENCES", () => {
  // schema.ts spells the CHECK's value list out (sql.raw is banned), so this
  // holds the two equal.
  it("matches recurring_transactions_cadence_check in drizzle/schema.ts", () => {
    const schema = readFileSync(resolve(__dirname, "../../../../drizzle/schema.ts"), "utf8");
    const match = /recurring_transactions_cadence_check", sql`cadence = ANY \(ARRAY\[([^\]]+)\]\)/.exec(schema);
    expect(match).not.toBeNull();
    const values = [...match![1].matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]);
    expect(values).toEqual([...CADENCES]);
  });
});
