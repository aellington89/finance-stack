import { describe, it, expect } from "vitest";
import {
  checkRecurringSchedule,
  isScheduleChange,
  recurringTransactionFormSchema,
  type RecurringScheduleFacts,
  type StoredSchedule,
  type SubmittedSchedule,
} from "@/lib/validations/recurring-transaction";

const validForm = {
  transactionDescription: "Rent",
  amount: "-1450.00",
  accountId: "1",
  transactionTypeId: "2",
  transactionCategoryId: "3",
  cadence: "monthly",
  intervalCount: "1",
  nextRunDate: "2026-12-01",
};

const fieldsOf = (input: Record<string, unknown>) => {
  const result = recurringTransactionFormSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("recurringTransactionFormSchema", () => {
  it("accepts a minimal monthly template", () => {
    expect(recurringTransactionFormSchema.safeParse(validForm).success).toBe(true);
  });

  it("accepts every cadence, a related account, an end date and the active flag", () => {
    for (const cadence of ["daily", "weekly", "monthly", "yearly"]) {
      expect(
        recurringTransactionFormSchema.safeParse({
          ...validForm,
          cadence,
          relatedAccountId: "4",
          endDate: "2027-12-01",
          isActive: "false",
        }).success
      ).toBe(true);
    }
  });

  it("treats an empty end date as no end", () => {
    expect(recurringTransactionFormSchema.safeParse({ ...validForm, endDate: "" }).success).toBe(true);
  });

  it("authors a message for every omitted field, rather than Zod's own", () => {
    expect(fieldsOf({})).toEqual({
      transactionDescription: "Description is required",
      amount: "Amount is required",
      accountId: "Account is required",
      transactionTypeId: "Transaction type is required",
      transactionCategoryId: "Category is required",
      cadence: "Choose how often it repeats",
      intervalCount: "Repeat every 1 to 99",
      nextRunDate: "Next date is required",
    });
  });

  it("authors a message for null fields, as formData.get() yields them", () => {
    const keys = [...Object.keys(validForm), "relatedAccountId", "endDate", "isActive"];
    const messages = Object.values(fieldsOf(Object.fromEntries(keys.map((k) => [k, null]))));
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => !/expected|received/i.test(m))).toBe(true);
  });

  it.each(["hourly", "Monthly", ""])("rejects a cadence of %j", (cadence) => {
    expect(fieldsOf({ ...validForm, cadence }).cadence).toBe("Choose how often it repeats");
  });

  it.each(["0", "100", "1.5", "-1", "two", ""])("rejects an interval of %j", (intervalCount) => {
    expect(fieldsOf({ ...validForm, intervalCount }).intervalCount).toBe("Repeat every 1 to 99");
  });

  it.each(["1", "2", "99", "07"])("accepts an interval of %j", (intervalCount) => {
    expect(recurringTransactionFormSchema.safeParse({ ...validForm, intervalCount }).success).toBe(true);
  });

  it.each(["2026-02-30", "2026-2-1", "tomorrow"])("rejects a next date of %s", (nextRunDate) => {
    expect(fieldsOf({ ...validForm, nextRunDate }).nextRunDate).toBe(
      "Next date must be a valid date in YYYY-MM-DD format"
    );
  });

  it.each(["2027-02-30", "soon"])("rejects an end date of %s", (endDate) => {
    expect(fieldsOf({ ...validForm, endDate }).endDate).toBe("End date must be a valid date in YYYY-MM-DD format");
  });

  it("rejects an active flag other than true/false", () => {
    expect(fieldsOf({ ...validForm, isActive: "on" }).isActive).toBe("Invalid active setting");
  });

  it("shares the transaction fields' rules", () => {
    expect(fieldsOf({ ...validForm, amount: "12.345" }).amount).toBe(
      "Enter a valid dollar amount (e.g. 123.45 or -50.00)"
    );
    expect(fieldsOf({ ...validForm, accountId: "1.5" }).accountId).toBe("Invalid account");
    expect(fieldsOf({ ...validForm, relatedAccountId: "1" }).relatedAccountId).toBe(
      "Related account must be different from the primary account"
    );
  });
});

const submitted = (overrides: Partial<SubmittedSchedule> = {}): SubmittedSchedule => ({
  cadence: "monthly",
  every: 1,
  nextRunDate: "2026-12-01",
  endDate: null,
  isActive: true,
  accountId: 1,
  ...overrides,
});

const stored = (overrides: Partial<StoredSchedule> = {}): StoredSchedule => ({
  cadence: "monthly",
  every: 1,
  anchorDate: "2026-06-01",
  nextRunDate: "2026-12-01",
  endDate: null,
  isActive: true,
  accountId: 1,
  ...overrides,
});

const facts = (overrides: Partial<RecurringScheduleFacts> = {}): RecurringScheduleFacts => ({
  submitted: submitted(),
  stored: null,
  today: "2026-11-14",
  account: { openedDate: "2020-01-01", closedDate: null },
  ...overrides,
});

describe("isScheduleChange", () => {
  it("is false when only other fields differ", () => {
    expect(isScheduleChange(submitted({ endDate: "2027-01-01", isActive: false, accountId: 2 }), stored())).toBe(false);
  });

  it.each<[Partial<SubmittedSchedule>]>([[{ cadence: "weekly" }], [{ every: 2 }], [{ nextRunDate: "2026-12-02" }]])(
    "is true for %o",
    (change) => {
      expect(isScheduleChange(submitted(change), stored())).toBe(true);
    }
  );
});

describe("checkRecurringSchedule", () => {
  it("accepts a valid create", () => {
    expect(checkRecurringSchedule(facts())).toEqual([]);
  });

  it("returns only the account problem when the account doesn't exist", () => {
    expect(checkRecurringSchedule(facts({ account: null }))).toEqual([
      { field: "accountId", message: "Account not found" },
    ]);
  });

  it("refuses an active template on a closed account", () => {
    expect(checkRecurringSchedule(facts({ account: { openedDate: null, closedDate: "2026-10-01" } }))).toEqual([
      {
        field: "accountId",
        message: "This account is closed. Pick an open account, or leave the recurring transaction paused.",
      },
    ]);
  });

  it("allows a paused template on a closed account to be edited", () => {
    expect(
      checkRecurringSchedule(
        facts({
          submitted: submitted({ isActive: false }),
          stored: stored({ isActive: false }),
          account: { openedDate: null, closedDate: "2026-10-01" },
        })
      )
    ).toEqual([]);
  });

  describe("the one-year floor", () => {
    it("accepts a next date exactly a year back", () => {
      expect(checkRecurringSchedule(facts({ submitted: submitted({ nextRunDate: "2025-11-14" }) }))).toEqual([]);
    });

    it("refuses a next date a day earlier", () => {
      expect(checkRecurringSchedule(facts({ submitted: submitted({ nextRunDate: "2025-11-13" }) }))).toEqual([
        { field: "nextRunDate", message: "Next date can't be more than a year in the past." },
      ]);
    });

    it("clamps a leap-day today", () => {
      const leap = facts({ today: "2028-02-29" });
      expect(checkRecurringSchedule({ ...leap, submitted: submitted({ nextRunDate: "2027-02-28" }) })).toEqual([]);
      expect(checkRecurringSchedule({ ...leap, submitted: submitted({ nextRunDate: "2027-02-27" }) })).toHaveLength(1);
    });

    it("doesn't apply to an untouched next date on update", () => {
      expect(
        checkRecurringSchedule(
          facts({
            submitted: submitted({ nextRunDate: "2024-01-01" }),
            stored: stored({ anchorDate: "2024-01-01", nextRunDate: "2024-01-01", isActive: false }),
          })
        )
      ).toEqual([]);
    });

    it("applies when the update changes the schedule", () => {
      expect(
        checkRecurringSchedule(facts({ submitted: submitted({ nextRunDate: "2024-01-01" }), stored: stored() }))
      ).toEqual([{ field: "nextRunDate", message: "Next date can't be more than a year in the past." }]);
    });
  });

  describe("the opened date", () => {
    const lateOpen = { openedDate: "2026-12-15", closedDate: null };

    it("refuses a next date before the account opened", () => {
      expect(checkRecurringSchedule(facts({ account: lateOpen }))).toEqual([
        { field: "nextRunDate", message: "Next date is before this account was opened." },
      ]);
    });

    it("accepts the opening day itself", () => {
      expect(
        checkRecurringSchedule(facts({ account: lateOpen, submitted: submitted({ nextRunDate: "2026-12-15" }) }))
      ).toEqual([]);
    });

    it("applies on update when the account changes", () => {
      expect(
        checkRecurringSchedule(facts({ account: lateOpen, submitted: submitted({ accountId: 2 }), stored: stored() }))
      ).toHaveLength(1);
    });

    it("doesn't apply to an unchanged schedule on the same account", () => {
      expect(checkRecurringSchedule(facts({ account: lateOpen, stored: stored() }))).toEqual([]);
    });
  });

  describe("the end date", () => {
    it("must be on or after the next date on create", () => {
      expect(checkRecurringSchedule(facts({ submitted: submitted({ endDate: "2026-11-30" }) }))).toEqual([
        { field: "endDate", message: "Ends must be on or after Next date." },
      ]);
      expect(checkRecurringSchedule(facts({ submitted: submitted({ endDate: "2026-12-01" }) }))).toEqual([]);
    });

    it("must be on or after the next date when the schedule changes", () => {
      expect(
        checkRecurringSchedule(
          facts({ submitted: submitted({ every: 2, endDate: "2026-11-30" }), stored: stored() })
        )
      ).toEqual([{ field: "endDate", message: "Ends must be on or after Next date." }]);
    });

    it("lets an Ended template be edited with only its description changed", () => {
      // Ended: next date (Dec 1) is past the end (Nov 1). Nothing schedule-related changed.
      const ended = stored({ nextRunDate: "2026-12-01", endDate: "2026-11-01" });
      expect(
        checkRecurringSchedule(facts({ submitted: submitted({ endDate: "2026-11-01" }), stored: ended }))
      ).toEqual([]);
    });

    it("lets an Ended template be extended", () => {
      const ended = stored({ nextRunDate: "2026-12-01", endDate: "2026-11-01" });
      expect(
        checkRecurringSchedule(facts({ submitted: submitted({ endDate: "2027-06-01" }), stored: ended }))
      ).toEqual([]);
    });

    it("holds an unchanged schedule's end date to its anchor, as the database does", () => {
      expect(
        checkRecurringSchedule(facts({ submitted: submitted({ endDate: "2026-05-31" }), stored: stored() }))
      ).toEqual([{ field: "endDate", message: "Ends must be on or after 2026-06-01, when this schedule started." }]);
    });
  });

  it("reports every problem at once", () => {
    expect(
      checkRecurringSchedule(
        facts({
          submitted: submitted({ nextRunDate: "2020-01-01", endDate: "2019-12-31" }),
          account: { openedDate: "2021-01-01", closedDate: "2026-01-01" },
        })
      ).map((p) => p.field)
    ).toEqual(["accountId", "nextRunDate", "nextRunDate", "endDate"]);
  });
});
