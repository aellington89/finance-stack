import { describe, it, expect } from "vitest";
import {
  STATUS_LABELS,
  previewSchedule,
  previewSentence,
  recurringStatus,
  todayAsOf,
  type PreviewInput,
} from "@/components/transactions/recurring-schedule-view";
import { countOccurrencesThrough, nextOccurrences, type Cadence } from "@/lib/recurring/schedule";
import { resolveSchedule } from "@/lib/validations/recurring-transaction";

describe("recurringStatus", () => {
  type StatusInput = Parameters<typeof recurringStatus>[0];
  const base: StatusInput = { isActive: true, nextRunDate: "2026-12-01", endDate: null, accountClosedDate: null };

  it.each<[Partial<StatusInput>, string]>([
    [{}, "active"],
    [{ isActive: false }, "paused"],
    [{ isActive: false, accountClosedDate: "2026-11-01" }, "paused-account-closed"],
    [{ accountClosedDate: "2026-11-01" }, "account-closed"],
    [{ endDate: "2026-11-30" }, "ended"],
    [{ endDate: "2026-11-30", isActive: false, accountClosedDate: "2026-11-01" }, "ended"],
    [{ endDate: "2026-12-01" }, "active"],
  ])("%o → %s", (overrides, expected) => {
    expect(recurringStatus({ ...base, ...overrides })).toBe(expected);
  });

  it("labels every status (AC9, AC12)", () => {
    expect(STATUS_LABELS).toEqual({
      active: "Active",
      ended: "Ended",
      paused: "Paused",
      "paused-account-closed": "Paused — account closed",
      "account-closed": "Account closed",
    });
  });
});

const input = (overrides: Partial<PreviewInput> = {}): PreviewInput => ({
  cadence: "monthly",
  intervalCount: "1",
  nextRunDate: "2026-12-01",
  endDate: "",
  isActive: true,
  stored: null,
  today: "2026-11-14",
  ...overrides,
});

describe("previewSchedule (AC18)", () => {
  it("lists the next three dates for a future template", () => {
    expect(previewSchedule(input())).toEqual({
      kind: "scheduled",
      dueNow: 0,
      upcoming: ["2026-12-01", "2027-01-01", "2027-02-01"],
    });
  });

  it("counts what a save adds at once, and lists what comes after today", () => {
    expect(previewSchedule(input({ cadence: "daily", nextRunDate: "2026-11-12" }))).toEqual({
      kind: "scheduled",
      dueNow: 3,
      upcoming: ["2026-11-15", "2026-11-16", "2026-11-17"],
    });
  });

  it("counts a next date of today as added now, and lists from tomorrow", () => {
    expect(previewSchedule(input({ cadence: "daily", nextRunDate: "2026-11-14" }))).toEqual({
      kind: "scheduled",
      dueNow: 1,
      upcoming: ["2026-11-15", "2026-11-16", "2026-11-17"],
    });
  });

  it("stops the upcoming list at the end date", () => {
    expect(previewSchedule(input({ endDate: "2027-01-15" }))).toEqual({
      kind: "scheduled",
      dueNow: 0,
      upcoming: ["2026-12-01", "2027-01-01"],
    });
  });

  it("says paused when the template is inactive", () => {
    expect(previewSchedule(input({ isActive: false }))).toEqual({ kind: "paused" });
  });

  it.each<[Partial<PreviewInput>]>([
    [{ cadence: "hourly" }],
    [{ intervalCount: "" }],
    [{ intervalCount: "0" }],
    [{ intervalCount: "100" }],
    [{ intervalCount: "1.5" }],
    [{ nextRunDate: "" }],
    [{ nextRunDate: "2026-02-30" }],
    [{ endDate: "soon" }],
    [{ today: "" }],
  ])("is incomplete for %o", (overrides) => {
    expect(previewSchedule(input(overrides))).toEqual({ kind: "incomplete" });
  });

  it("is incomplete rather than throwing on a backfill too long to count", () => {
    expect(previewSchedule(input({ cadence: "daily", nextRunDate: "1900-01-01" }))).toEqual({ kind: "incomplete" });
  });

  describe("when editing", () => {
    const stored = {
      cadence: "monthly" as const,
      intervalCount: 1,
      anchorDate: "2026-01-31",
      nextRunDate: "2026-11-30",
      isActive: true,
    };

    it("keeps the stored anchor for an unchanged schedule, so the 31st returns", () => {
      expect(previewSchedule(input({ nextRunDate: "2026-11-30", stored, today: "2026-11-14" }))).toEqual({
        kind: "scheduled",
        dueNow: 0,
        upcoming: ["2026-11-30", "2026-12-31", "2027-01-31"],
      });
    });

    it("anchors on the new next date when the schedule changes", () => {
      expect(
        previewSchedule(input({ nextRunDate: "2026-11-30", intervalCount: "2", stored, today: "2026-11-14" }))
      ).toEqual({ kind: "scheduled", dueNow: 0, upcoming: ["2026-11-30", "2027-01-30", "2027-03-30"] });
    });

    it("skips the dates missed while paused when resuming without a new date", () => {
      const paused = { ...stored, nextRunDate: "2026-08-31", isActive: false };
      expect(previewSchedule(input({ nextRunDate: "2026-08-31", stored: paused, today: "2026-11-14" }))).toEqual({
        kind: "scheduled",
        dueNow: 0,
        upcoming: ["2026-11-30", "2026-12-31", "2027-01-31"],
      });
    });

    it("backfills from an explicit next date set while resuming", () => {
      const paused = { ...stored, nextRunDate: "2026-08-31", isActive: false };
      expect(previewSchedule(input({ nextRunDate: "2026-09-30", stored: paused, today: "2026-11-14" }))).toMatchObject({
        kind: "scheduled",
        dueNow: 2,
      });
    });

    it("is incomplete if the stored next date isn't an occurrence of its anchor", () => {
      const broken = { ...stored, nextRunDate: "2026-11-15" };
      expect(previewSchedule(input({ nextRunDate: "2026-11-15", stored: broken }))).toEqual({ kind: "incomplete" });
    });

    // The preview keeps its own copy of the save's anchor and resume rules, so
    // that the client bundle has no zod. This holds the copy to resolveSchedule().
    it.each<[string, Partial<PreviewInput>, Partial<typeof stored>]>([
      ["an unchanged schedule", { nextRunDate: "2026-11-30" }, {}],
      ["an unchanged schedule that's behind", { nextRunDate: "2026-10-31" }, { nextRunDate: "2026-10-31" }],
      ["a new interval", { nextRunDate: "2026-11-30", intervalCount: "2" }, {}],
      ["a new cadence", { nextRunDate: "2026-11-30", cadence: "weekly" }, {}],
      ["a new next date in the past", { nextRunDate: "2026-10-31" }, {}],
      ["a late resume", { nextRunDate: "2026-08-31" }, { nextRunDate: "2026-08-31", isActive: false }],
      ["a resume with a new date", { nextRunDate: "2026-09-30" }, { nextRunDate: "2026-08-31", isActive: false }],
      ["a resume not yet due", { nextRunDate: "2026-11-30" }, { isActive: false }],
    ])("starts from the anchor and next date the save stores, for %s", (_, overrides, storedOverrides) => {
      const row = { ...stored, ...storedOverrides };
      const given = input({ ...overrides, stored: row });
      const submitted = {
        cadence: given.cadence as Cadence,
        every: Number(given.intervalCount),
        nextRunDate: given.nextRunDate,
        endDate: null,
        isActive: given.isActive,
        accountId: 1,
      };
      const saved = resolveSchedule(
        submitted,
        { ...row, every: row.intervalCount, endDate: null, accountId: 1 },
        given.today
      );
      const schedule = { cadence: submitted.cadence, every: submitted.every, anchorDate: saved.anchorDate, endDate: null };
      const from = saved.nextRunDate > given.today ? saved.nextRunDate : "2026-11-15";

      expect(previewSchedule(given)).toEqual({
        kind: "scheduled",
        dueNow: countOccurrencesThrough(schedule, saved.nextRunDate, given.today),
        upcoming: nextOccurrences(schedule, from, 3),
      });
    });
  });
});

describe("previewSentence (AC18)", () => {
  it("says nothing while the fields make no schedule", () => {
    expect(previewSentence({ kind: "incomplete" })).toBe("");
  });

  it("says a paused template adds nothing", () => {
    expect(previewSentence({ kind: "paused" })).toBe("Paused: nothing is added until it is made active again.");
  });

  it("lists the next dates when nothing is due yet", () => {
    expect(previewSentence({ kind: "scheduled", dueNow: 0, upcoming: ["2026-12-01", "2027-01-01"] })).toBe(
      "Next: Dec 1, 2026 · Jan 1, 2027"
    );
  });

  it("counts one date due now in the singular, and several in the plural", () => {
    expect(previewSentence({ kind: "scheduled", dueNow: 1, upcoming: ["2026-12-14"] })).toBe(
      "1 date is on or before today, and is added when you save. Next: Dec 14, 2026"
    );
    expect(previewSentence({ kind: "scheduled", dueNow: 3, upcoming: ["2026-11-29"] })).toBe(
      "3 dates are on or before today, and are added when you save. Next: Nov 29, 2026"
    );
  });

  it("says when no date comes after today before the end", () => {
    expect(previewSentence({ kind: "scheduled", dueNow: 2, upcoming: [] })).toBe(
      "2 dates are on or before today, and are added when you save. No dates after today before it ends."
    );
  });
});

describe("todayAsOf", () => {
  // The page read "2026-11-14", and the database's day ends at this instant.
  const endsAt = Date.UTC(2026, 10, 15);

  it("is the page's date until that date ends", () => {
    expect(todayAsOf("2026-11-14", endsAt, endsAt - 1)).toBe("2026-11-14");
  });

  it("moves on a day once it has ended, as Postgres's CURRENT_DATE does", () => {
    expect(todayAsOf("2026-11-14", endsAt, endsAt)).toBe("2026-11-15");
    expect(todayAsOf("2026-11-14", endsAt, endsAt + 86_400_000 - 1)).toBe("2026-11-15");
  });

  it("moves on as many days as have passed, across a month and a year", () => {
    expect(todayAsOf("2026-12-30", Date.UTC(2026, 11, 31), Date.UTC(2027, 0, 2, 12))).toBe("2027-01-02");
  });

  it("keeps the page's date when the end instant isn't a number", () => {
    expect(todayAsOf("2026-11-14", Number.NaN, endsAt + 1)).toBe("2026-11-14");
  });
});
