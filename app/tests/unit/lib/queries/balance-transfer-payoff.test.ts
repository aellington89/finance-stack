import { describe, it, expect } from "vitest";
import {
  DAYS_PER_MONTH,
  balanceKey,
  balanceProbes,
  buildBalanceTransferTracker,
  daysRemaining,
  monthlyPace,
  monthsRemaining,
  paceWindowStarts,
  projectedDebt,
  requiredPayment,
  trackerStatus,
  type ActiveTransferRow,
} from "@/lib/queries/balance-transfer-payoff";

// All figures are synthetic (Issue #417's worked example and variations).

const row = (overrides: Partial<ActiveTransferRow> = {}): ActiveTransferRow => ({
  balanceTransferId: 1,
  accountId: 9,
  accountName: "Card B",
  postingTransactionId: 100,
  postingDate: "2025-11-10",
  postingAmount: -6000,
  sourceAccountName: "Card A",
  promoEndDate: "2027-11-10",
  promoApr: 0,
  feeTransactionId: 101,
  feeAmount: -180,
  feeDate: "2025-11-13",
  balance: -4200,
  asOf: "2026-11-10",
  ...overrides,
});

/** The start balance that makes a window's net pace exactly `pace`. */
const startFor = (end: number, pace: number, days: number) =>
  end - (pace * days) / DAYS_PER_MONTH;

describe("monthsRemaining", () => {
  it("counts an exact number of calendar months", () => {
    expect(monthsRemaining("2026-11-10", "2027-11-10")).toBe(12);
  });

  it("rounds a part month up", () => {
    expect(monthsRemaining("2026-11-10", "2027-11-11")).toBe(13);
    expect(monthsRemaining("2026-11-10", "2026-12-09")).toBe(1);
  });

  it("never returns less than 1", () => {
    expect(monthsRemaining("2026-11-10", "2026-11-11")).toBe(1);
  });

  it("clamps to the end of a shorter month", () => {
    // Jan 31 + 1 month is Feb 28, so a Feb 28 end is one month away and
    // Mar 1 is two.
    expect(monthsRemaining("2026-01-31", "2026-02-28")).toBe(1);
    expect(monthsRemaining("2026-01-31", "2026-03-01")).toBe(2);
    expect(monthsRemaining("2026-01-31", "2026-03-31")).toBe(2);
  });

  it("handles long promos without drifting", () => {
    expect(monthsRemaining("2026-01-15", "2028-01-15")).toBe(24);
    expect(monthsRemaining("2026-01-15", "2028-01-16")).toBe(25);
  });
});

describe("daysRemaining", () => {
  it("counts calendar days to the (exclusive) end date", () => {
    expect(daysRemaining("2026-11-10", "2026-11-11")).toBe(1);
    expect(daysRemaining("2026-11-10", "2027-02-08")).toBe(90);
  });

  it("is not thrown off by a daylight-saving change", () => {
    expect(daysRemaining("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysRemaining("2026-10-31", "2026-11-02")).toBe(2);
  });
});

describe("paceWindowStarts", () => {
  it("uses the trailing 3 months and the range when the promo predates both", () => {
    expect(paceWindowStarts("2026-11-10", "2026-01-01", "2025-06-01")).toEqual({
      threeMonth: "2026-08-10",
      range: "2026-01-01",
    });
  });

  it("starts both windows at the posting when it is more recent", () => {
    expect(paceWindowStarts("2026-11-10", "2026-01-01", "2026-10-01")).toEqual({
      threeMonth: "2026-10-01",
      range: "2026-10-01",
    });
  });

  it("starts the range window at the range when that is later", () => {
    expect(paceWindowStarts("2026-11-10", "2026-10-20", "2026-01-01")).toEqual({
      threeMonth: "2026-08-10",
      range: "2026-10-20",
    });
  });

  it("clamps the 3-month start to the end of a shorter month", () => {
    expect(paceWindowStarts("2026-05-31", "2026-01-01", "2025-01-01").threeMonth).toBe(
      "2026-02-28"
    );
  });
});

describe("monthlyPace", () => {
  const base = {
    start: "2026-08-10",
    end: "2026-11-10", // 92 days
    linked: [],
  };

  it("turns a net balance change into a monthly paydown rate", () => {
    const pace = monthlyPace({ ...base, startBalance: -5000, endBalance: -4100 });
    expect(pace).toBeCloseTo((900 / 92) * DAYS_PER_MONTH, 10);
  });

  it("is negative when the debt grew", () => {
    const pace = monthlyPace({ ...base, startBalance: -4100, endBalance: -5000 });
    expect(pace).toBeLessThan(0);
  });

  it("takes linked postings inside (start, end] back out", () => {
    // A fee of 180 posted inside the window: without the exclusion the window
    // would read 180 worse than it was.
    const pace = monthlyPace({
      ...base,
      startBalance: -5000,
      endBalance: -4280,
      linked: [{ date: "2026-09-01", amount: -180 }],
    });
    expect(pace).toBeCloseTo((900 / 92) * DAYS_PER_MONTH, 10);
  });

  it("leaves out a linked posting on the start day, which the start balance already holds", () => {
    const pace = monthlyPace({
      ...base,
      startBalance: -5000,
      endBalance: -4100,
      linked: [{ date: "2026-08-10", amount: -6000 }],
    });
    expect(pace).toBeCloseTo((900 / 92) * DAYS_PER_MONTH, 10);
  });

  it("counts a linked posting on the end day as inside the window", () => {
    const pace = monthlyPace({
      ...base,
      startBalance: -5000,
      endBalance: -4280,
      linked: [{ date: "2026-11-10", amount: -180 }],
    });
    expect(pace).toBeCloseTo((900 / 92) * DAYS_PER_MONTH, 10);
  });

  it("ignores linked postings outside the window", () => {
    const pace = monthlyPace({
      ...base,
      startBalance: -5000,
      endBalance: -4100,
      linked: [
        { date: "2026-08-01", amount: -6000 },
        { date: "2026-12-01", amount: -180 },
      ],
    });
    expect(pace).toBeCloseTo((900 / 92) * DAYS_PER_MONTH, 10);
  });

  it("returns null for a window under 30 days", () => {
    expect(
      monthlyPace({ startBalance: -5000, endBalance: -4900, start: "2026-10-12", end: "2026-11-10", linked: [] })
    ).toBeNull(); // 29 days
    expect(
      monthlyPace({ startBalance: -5000, endBalance: -4900, start: "2026-10-11", end: "2026-11-10", linked: [] })
    ).not.toBeNull(); // 30 days
  });

  it("returns null for a zero-day window even with no floor", () => {
    expect(
      monthlyPace({ startBalance: -5000, endBalance: -5000, start: "2026-11-10", end: "2026-11-10", linked: [], minDays: 0 })
    ).toBeNull();
  });

  it("returns null when the start date has no balance row", () => {
    expect(monthlyPace({ ...base, startBalance: null, endBalance: -4100 })).toBeNull();
  });
});

describe("requiredPayment", () => {
  it("is debt over months at 0%", () => {
    expect(requiredPayment(4200, 0, 12)).toBe(350);
  });

  it("amortizes at a promo rate above 0%", () => {
    // 3.99% over 12 months: 4200 × r / (1 − (1 + r)^−12), r = 0.0399 / 12.
    expect(requiredPayment(4200, 3.99, 12)).toBeCloseTo(357.61, 2);
  });

  it("is the debt plus a month's interest over a single month", () => {
    // 100% APR, one month: debt × (1 + 1/12).
    expect(requiredPayment(1200, 100, 1)).toBeCloseTo(1300, 10);
  });

  it("is zero when nothing is owed", () => {
    expect(requiredPayment(0, 3.99, 12)).toBe(0);
  });
});

describe("projectedDebt", () => {
  it("is debt minus pace times months at 0%", () => {
    expect(projectedDebt(4200, 0, 12, 300)).toBe(600);
  });

  it("clamps at zero when the pace would clear it early", () => {
    expect(projectedDebt(4200, 0, 12, 400)).toBe(0);
    expect(projectedDebt(4200, 3.99, 12, 400)).toBe(0);
  });

  it("grows when the debt is growing", () => {
    expect(projectedDebt(4200, 0, 12, -50)).toBe(4800);
  });

  it("accrues interest at a promo rate above 0%", () => {
    const projected = projectedDebt(4200, 3.99, 12, 300);
    expect(projected).toBeCloseTo(533.4, 0);
    // The shortfall, compounded over the remaining months, is what is left:
    // consistent with the status's short-per-month.
    const r = 0.0399 / 12;
    const gross = 300 + 4200 * r;
    const short = requiredPayment(4200, 3.99, 12) - gross;
    expect(projected).toBeCloseTo((short * (Math.pow(1 + r, 12) - 1)) / r, 6);
  });
});

describe("trackerStatus", () => {
  const behind = {
    debt: 4200,
    apr: 0,
    requiredPerMonth: 350,
    threeMonthPace: 300,
  };

  it("is behind, by the shortfall, when the pace falls short", () => {
    expect(trackerStatus({ ...behind, daysLeft: 365 })).toEqual({
      kind: "behind",
      shortPerMonth: 50,
    });
  });

  it("is on track when the pace meets the required paydown", () => {
    expect(trackerStatus({ ...behind, threeMonthPace: 350, daysLeft: 365 })).toEqual({
      kind: "on_track",
    });
  });

  it("warns of expiry at 90 days, even when behind", () => {
    expect(trackerStatus({ ...behind, daysLeft: 90 })).toEqual({
      kind: "expiring",
      daysLeft: 90,
    });
    expect(trackerStatus({ ...behind, daysLeft: 91 }).kind).toBe("behind");
  });

  it("does not warn of expiry when nothing is owed", () => {
    expect(trackerStatus({ ...behind, debt: 0, daysLeft: 10 })).toEqual({
      kind: "on_track",
    });
  });

  it("is too new to project without a 3-month pace", () => {
    expect(trackerStatus({ ...behind, threeMonthPace: null, daysLeft: 365 })).toEqual({
      kind: "too_new",
    });
    // Expiry still wins.
    expect(trackerStatus({ ...behind, threeMonthPace: null, daysLeft: 30 }).kind).toBe(
      "expiring"
    );
  });

  it("ignores a shortfall below half a cent", () => {
    expect(
      trackerStatus({ ...behind, threeMonthPace: 349.996, daysLeft: 365 }).kind
    ).toBe("on_track");
  });

  it("measures the shortfall against the gross payment above 0%", () => {
    const status = trackerStatus({
      debt: 4200,
      apr: 3.99,
      requiredPerMonth: requiredPayment(4200, 3.99, 12),
      threeMonthPace: 300,
      daysLeft: 365,
    });
    expect(status.kind).toBe("behind");
    if (status.kind === "behind") {
      expect(status.shortPerMonth).toBeCloseTo(43.65, 2);
    }
  });
});

describe("balanceProbes", () => {
  it("asks for nothing when no transfer is active", () => {
    expect(balanceProbes([], "2026-01-01")).toEqual([]);
  });

  it("asks for each card's two window starts once", () => {
    const probes = balanceProbes(
      [
        row(),
        row({ balanceTransferId: 2, postingTransactionId: 200, promoEndDate: "2028-01-01" }),
        row({ balanceTransferId: 3, accountId: 12, postingDate: "2026-10-01" }),
      ],
      "2026-01-01"
    );
    expect(probes).toEqual([
      { accountId: 9, date: "2026-08-10" },
      { accountId: 9, date: "2026-01-01" },
      // Card 12's promo began inside both windows, so both start there.
      { accountId: 12, date: "2026-10-01" },
    ]);
  });
});

describe("buildBalanceTransferTracker", () => {
  // As of 2026-11-10, the row factory's default.
  const threeMonthStart = "2026-08-10"; // 92 days before asOf
  const rangeStart = "2026-05-10"; // 184 days before asOf

  const balances = (paceThree: number, paceRange: number) =>
    new Map([
      [balanceKey(9, threeMonthStart), startFor(-4200, paceThree, 92)],
      [balanceKey(9, rangeStart), startFor(-4200, paceRange, 184)],
    ]);

  it("reproduces the issue's worked example at 0%", () => {
    const [tracked] = buildBalanceTransferTracker([row()], balances(300, 500), rangeStart);

    expect(tracked.debt).toBe(4200);
    expect(tracked.monthsRemaining).toBe(12);
    expect(tracked.requiredPerMonth).toBe(350);
    expect(tracked.threeMonthPace).toBeCloseTo(300, 8);
    expect(tracked.rangePace).toBeCloseTo(500, 8);
    expect(tracked.projectedAtExpiry).toBeCloseTo(600, 6);
    expect(tracked.monthlyInterest).toBeNull();
    expect(tracked.status.kind).toBe("behind");
    if (tracked.status.kind === "behind") {
      expect(tracked.status.shortPerMonth).toBeCloseTo(50, 6);
    }
    // Displayed as magnitudes.
    expect(tracked.primary).toMatchObject({
      sourceAccountName: "Card A",
      transferredAmount: 6000,
      feeAmount: 180,
      promoApr: 0,
    });
  });

  it("uses the 3-month pace for the projection and status, not the range pace", () => {
    // A strong range pace does not rescue a weak 3-month pace.
    const [tracked] = buildBalanceTransferTracker([row()], balances(300, 900), rangeStart);
    expect(tracked.status.kind).toBe("behind");
    expect(tracked.projectedAtExpiry).toBeCloseTo(600, 6);
  });

  it("accounts for a promo rate above 0%", () => {
    const [tracked] = buildBalanceTransferTracker(
      [row({ promoApr: 3.99 })],
      balances(300, 500),
      rangeStart
    );
    expect(tracked.monthlyInterest).toBeCloseTo(4200 * (0.0399 / 12), 10);
    expect(tracked.requiredPerMonth).toBeCloseTo(357.61, 2);
    expect(tracked.projectedAtExpiry).toBeCloseTo(533.4, 0);
  });

  it("leaves the transfer's own posting and fee out of both paces", () => {
    // The promo began inside both windows. The posting is on the start day and
    // the fee three days later, so only the fee needs taking back out. With no
    // other activity, the pace is zero rather than "180 behind".
    const postingDate = "2026-09-01";
    const tracked = buildBalanceTransferTracker(
      [
        row({
          postingDate,
          feeDate: "2026-09-04",
          balance: -6180,
        }),
      ],
      new Map([[balanceKey(9, postingDate), -6000]]),
      "2026-01-01"
    )[0];
    expect(tracked.threeMonthPace).toBeCloseTo(0, 10);
    expect(tracked.rangePace).toBeCloseTo(0, 10);
  });

  it("shows no range pace for a range under 30 days, and keeps the 3-month pace", () => {
    const shortRange = "2026-10-20";
    const [tracked] = buildBalanceTransferTracker(
      [row()],
      new Map([
        [balanceKey(9, threeMonthStart), startFor(-4200, 300, 92)],
        [balanceKey(9, shortRange), -4300],
      ]),
      shortRange
    );
    expect(tracked.rangePace).toBeNull();
    expect(tracked.threeMonthPace).toBeCloseTo(300, 8);
  });

  it("is too new to project in a promo's first 30 days", () => {
    const postingDate = "2026-10-25";
    const [tracked] = buildBalanceTransferTracker(
      [row({ postingDate, feeDate: null, feeAmount: null, feeTransactionId: null })],
      new Map([[balanceKey(9, postingDate), -6000]]),
      "2026-01-01"
    );
    expect(tracked.threeMonthPace).toBeNull();
    expect(tracked.projectedAtExpiry).toBeNull();
    expect(tracked.status).toEqual({ kind: "too_new" });
    expect(tracked.primary.feeAmount).toBeNull();
  });

  it("gives a missing start balance a null pace", () => {
    const [tracked] = buildBalanceTransferTracker([row()], new Map(), rangeStart);
    expect(tracked.threeMonthPace).toBeNull();
    expect(tracked.rangePace).toBeNull();
  });

  it("treats a card in credit as owing nothing", () => {
    const [tracked] = buildBalanceTransferTracker(
      [row({ balance: 25, promoEndDate: "2026-12-01" })],
      balances(300, 500),
      rangeStart
    );
    expect(tracked.debt).toBe(0);
    expect(tracked.requiredPerMonth).toBe(0);
    expect(tracked.status).toEqual({ kind: "on_track" });
  });

  it("gives a card with overlapping transfers one row, keyed to its earliest end date", () => {
    const later = row({
      balanceTransferId: 2,
      postingTransactionId: 200,
      postingDate: "2026-06-01",
      postingAmount: -1500,
      sourceAccountName: null,
      promoEndDate: "2028-06-01",
      feeTransactionId: null,
      feeAmount: null,
      feeDate: null,
    });
    const tracker = buildBalanceTransferTracker([later, row()], balances(300, 500), rangeStart);

    expect(tracker).toHaveLength(1);
    expect(tracker[0].primary.balanceTransferId).toBe(1);
    expect(tracker[0].monthsRemaining).toBe(12);
    expect(tracker[0].others).toEqual([
      expect.objectContaining({
        balanceTransferId: 2,
        sourceAccountName: null,
        transferredAmount: 1500,
        feeAmount: null,
      }),
    ]);
  });

  it("orders cards by their soonest deadline", () => {
    const tracker = buildBalanceTransferTracker(
      [
        row({ accountId: 20, balanceTransferId: 5, promoEndDate: "2028-01-01" }),
        row({ accountId: 21, balanceTransferId: 6, promoEndDate: "2027-01-01" }),
      ],
      new Map(),
      rangeStart
    );
    expect(tracker.map((t) => t.accountId)).toEqual([21, 20]);
  });
});
