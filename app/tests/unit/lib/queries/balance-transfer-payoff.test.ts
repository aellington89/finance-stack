import { describe, it, expect } from "vitest";
import {
  DAYS_PER_MONTH,
  buildBalanceTransferTracker,
  daysRemaining,
  historyStarts,
  monthlyPace,
  monthsRemaining,
  paceWindowStarts,
  projectedDebt,
  requiredPayment,
  splitActiveTransfers,
  splitCardBalance,
  trackerStatus,
  type ActiveTransfer,
  type ActiveTransferRow,
  type SplitTransfer,
} from "@/lib/queries/balance-transfer-payoff";

// All figures are synthetic (Issues #417 and #427's worked examples, and
// variations on them).

const row = (overrides: Partial<ActiveTransferRow> = {}): ActiveTransferRow => ({
  balanceTransferId: 1,
  accountId: 9,
  accountName: "Card B",
  accountTypeId: 15,
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
    owed: 4200,
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

  it("is paid off when nothing is left on the transfer, ahead of every other rule", () => {
    expect(trackerStatus({ ...behind, owed: 0, daysLeft: 10 })).toEqual({
      kind: "paid_off",
    });
    // Even with debt paid ahead of it: that debt is not this transfer's.
    expect(trackerStatus({ ...behind, owed: 0.004, debt: 900, daysLeft: 365 })).toEqual({
      kind: "paid_off",
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
      owed: 4200,
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

// Issue #427. Each history is the card's balance on the days it changed: the
// split only acts on a change, so those rows are all a full daily history
// would add. Balances are ledger sign, so -4000 means $4,000 owed.
describe("splitCardBalance", () => {
  const transfer = (overrides: Partial<SplitTransfer> = {}): SplitTransfer => ({
    balanceTransferId: 1,
    postingDate: "2026-01-10",
    postingAmount: -4000,
    feeDate: null,
    feeAmount: null,
    promoEndDate: "2027-01-10",
    ...overrides,
  });

  /** Splits as of the last history row, unless told otherwise. */
  const split = (
    transfers: SplitTransfer[],
    history: [string, number][],
    asOf?: { date: string; balance: number }
  ) => {
    const last = history[history.length - 1];
    const result = splitCardBalance(
      transfers,
      history.map(([date, balance]) => ({ date, balance })),
      asOf?.date ?? last[0],
      asOf?.balance ?? last[1]
    );
    return { owed: Object.fromEntries(result.owed), nonPromo: result.nonPromo };
  };

  it("starts a transfer at its posting amount", () => {
    expect(split([transfer()], [["2026-01-10", -4000]])).toEqual({
      owed: { 1: 4000 },
      nonPromo: 0,
    });
  });

  it("clears non-promo debt first, then the soonest-ending transfer", () => {
    const transfers = [
      transfer({ balanceTransferId: 2, postingAmount: -10000, promoEndDate: "2026-12-01" }),
      transfer({ balanceTransferId: 1, postingAmount: -4000, promoEndDate: "2026-06-01" }),
    ];
    // $1,000 already owed, then both transfers post.
    const history: [string, number][] = [
      ["2026-01-10", -15000],
      ["2026-02-01", -13500], // $1,500 paid: the $1,000, then $500 of the first
      ["2026-03-01", -8500], //  $5,000 paid: the first's $3,500, then the second
    ];

    expect(split(transfers, history.slice(0, 2))).toEqual({
      owed: { 1: 3500, 2: 10000 },
      nonPromo: 0,
    });
    expect(split(transfers, history)).toEqual({
      owed: { 1: 0, 2: 8500 },
      nonPromo: 0,
    });
  });

  it("puts new charges in non-promo debt only", () => {
    expect(
      split(
        [transfer()],
        [
          ["2026-01-10", -4000],
          ["2026-02-01", -4300], // a $300 purchase
          ["2026-03-01", -4100], // a $200 payment, which goes to the purchase
        ]
      )
    ).toEqual({ owed: { 1: 4000 }, nonPromo: 100 });
  });

  it("adds the fee to its transfer on the fee's own date", () => {
    const withFee = transfer({ feeDate: "2026-01-13", feeAmount: -120 });

    expect(
      split([withFee], [["2026-01-10", -4000], ["2026-01-13", -4120]])
    ).toEqual({ owed: { 1: 4120 }, nonPromo: 0 });

    // Paid off before the fee posts: the fee still joins the transfer rather
    // than reading as a purchase. Joined on the posting date, it would have
    // been cut with the rest, leaving $120 of non-promo debt.
    expect(
      split(
        [withFee],
        [["2026-01-10", -4000], ["2026-01-11", 0], ["2026-01-13", -120]]
      )
    ).toEqual({ owed: { 1: 120 }, nonPromo: 0 });
  });

  it("leaves out a fee dated after the as-of date", () => {
    expect(
      split([transfer({ feeDate: "2026-02-01", feeAmount: -120 })], [["2026-01-10", -4000]], {
        date: "2026-01-20",
        balance: -4000,
      })
    ).toEqual({ owed: { 1: 4000 }, nonPromo: 0 });
  });

  it("joins a fee dated before its posting on the posting date", () => {
    expect(
      split(
        [transfer({ feeDate: "2026-01-08", feeAmount: -120 })],
        [["2026-01-08", -120], ["2026-01-10", -4120]]
      )
    ).toEqual({ owed: { 1: 4120 }, nonPromo: 0 });
  });

  it("adds nothing for a linked fee that did not add debt", () => {
    expect(
      split(
        [transfer({ feeDate: "2026-01-13", feeAmount: 120 })],
        [["2026-01-10", -4000], ["2026-01-13", -3880]]
      )
    ).toEqual({ owed: { 1: 3880 }, nonPromo: 0 });
  });

  it("keeps the full balance of a shorter promo posted after a longer one was partly paid", () => {
    const longer = transfer({ postingAmount: -10000, promoEndDate: "2027-07-01" });
    const shorter = transfer({
      balanceTransferId: 2,
      postingDate: "2026-04-01",
      postingAmount: -2000,
      promoEndDate: "2026-10-01",
    });

    expect(
      split(
        [longer, shorter],
        [
          ["2026-01-10", -10000],
          ["2026-03-01", -7000],
          ["2026-04-01", -9000],
        ]
      )
    ).toEqual({ owed: { 1: 7000, 2: 2000 }, nonPromo: 0 });
  });

  it("breaks an end-date tie by id", () => {
    const sameEnd = { postingAmount: -1000, promoEndDate: "2026-09-01" };
    expect(
      split(
        [
          transfer({ balanceTransferId: 7, ...sameEnd }),
          transfer({ balanceTransferId: 3, ...sameEnd }),
        ],
        [["2026-01-10", -2000], ["2026-02-01", -1500]]
      )
    ).toEqual({ owed: { 3: 500, 7: 1000 }, nonPromo: 0 });
  });

  it("counts debt from before the posting, such as an ended promo's leftover, as paid first", () => {
    // $3,000 left over from a promo that has ended, then a new transfer.
    expect(
      split([transfer()], [["2026-01-10", -7000], ["2026-02-01", -5000]])
    ).toEqual({ owed: { 1: 4000 }, nonPromo: 1000 });
  });

  it("owes nothing on any transfer once the card is in credit", () => {
    expect(
      split(
        [transfer(), transfer({ balanceTransferId: 2, promoEndDate: "2028-01-01" })],
        [["2026-01-10", -8000], ["2026-02-01", 25]]
      )
    ).toEqual({ owed: { 1: 0, 2: 0 }, nonPromo: 0 });
  });

  it("applies a posting with no balance row that day at the next row", () => {
    expect(split([transfer()], [["2026-01-12", -4000]])).toEqual({
      owed: { 1: 4000 },
      nonPromo: 0,
    });
  });

  it("clamps against the as-of balance when history ends early", () => {
    expect(
      split([transfer()], [["2026-01-10", -4000]], { date: "2026-01-20", balance: -1000 })
    ).toEqual({ owed: { 1: 1000 }, nonPromo: 0 });
  });

  it("ignores history after the as-of date", () => {
    expect(
      split([transfer()], [["2026-01-10", -4000], ["2026-02-01", 0]], {
        date: "2026-01-20",
        balance: -4000,
      })
    ).toEqual({ owed: { 1: 4000 }, nonPromo: 0 });
  });

  it("works in cents, so float noise leaves nothing behind", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    expect(
      split(
        [transfer({ postingAmount: -0.1, feeDate: "2026-01-10", feeAmount: -0.2 })],
        [["2026-01-10", -0.3]]
      )
    ).toEqual({ owed: { 1: 0.3 }, nonPromo: 0 });
  });

  describe("the issue's worked example", () => {
    // Two 0% transfers on a card with no other balance: $4,000 + $120 ending
    // first, $10,000 + $300 ending three months later. $14,420 in all.
    const transfers = [
      transfer({ feeDate: "2026-01-12", feeAmount: -120, promoEndDate: "2026-12-10" }),
      transfer({
        balanceTransferId: 2,
        postingAmount: -10000,
        feeDate: "2026-01-12",
        feeAmount: -300,
        promoEndDate: "2027-03-10",
      }),
    ];
    const start: [string, number][] = [
      ["2026-01-10", -14000],
      ["2026-01-12", -14420],
    ];

    it("pays off the first transfer once $4,120 has been paid", () => {
      expect(split(transfers, [...start, ["2026-11-01", -8000]])).toEqual({
        owed: { 1: 0, 2: 8000 },
        nonPromo: 0,
      });
    });

    it("leaves part of the first while less than that has been paid", () => {
      expect(split(transfers, [...start, ["2026-11-01", -12000]])).toEqual({
        owed: { 1: 1700, 2: 10300 },
        nonPromo: 0,
      });
    });
  });
});

describe("historyStarts", () => {
  it("asks for nothing when no transfer is active", () => {
    expect(historyStarts([])).toEqual([]);
  });

  it("starts each card's history at its earliest active posting", () => {
    expect(
      historyStarts([
        row({ balanceTransferId: 2, postingTransactionId: 200, postingDate: "2026-06-01", promoEndDate: "2028-01-01" }),
        row(),
        row({ balanceTransferId: 3, accountId: 12, postingDate: "2026-10-01" }),
      ])
    ).toEqual([
      { accountId: 9, since: "2025-11-10" },
      { accountId: 12, since: "2026-10-01" },
    ]);
  });
});

describe("splitActiveTransfers", () => {
  const onCard = (overrides: Partial<ActiveTransferRow>) =>
    row({
      postingDate: "2026-01-10",
      feeTransactionId: null,
      feeAmount: null,
      feeDate: null,
      asOf: "2026-03-01",
      balance: -13400,
      ...overrides,
    });

  it("gives each transfer what is left on it, and what is paid ahead of it", () => {
    const [first, second] = splitActiveTransfers(
      [
        onCard({ balanceTransferId: 2, postingAmount: -10000, promoEndDate: "2027-03-10" }),
        onCard({ balanceTransferId: 1, postingAmount: -4000, promoEndDate: "2026-12-10" }),
      ],
      new Map([
        [
          9,
          [
            { date: "2026-01-10", balance: -15000 }, // $1,000 already owed
            { date: "2026-02-01", balance: -13000 }, // $2,000 paid
            { date: "2026-03-01", balance: -13400 }, // a $400 purchase
          ],
        ],
      ])
    );

    expect(first).toMatchObject({ balanceTransferId: 1, owed: 3000, aheadOfIt: 400 });
    expect(second).toMatchObject({ balanceTransferId: 2, owed: 10000, aheadOfIt: 3400 });
  });

  it("reads a card with no history as owing what its as-of balance says", () => {
    const [only] = splitActiveTransfers(
      [row({ accountId: 12, postingAmount: -500, feeAmount: null, feeDate: null, balance: -300 })],
      new Map()
    );
    expect(only).toMatchObject({ owed: 300, aheadOfIt: 0 });
  });
});

describe("buildBalanceTransferTracker", () => {
  // As of 2026-11-10, the row factory's default.
  const threeMonthStart = "2026-08-10"; // 92 days before asOf
  const rangeStart = "2026-05-10"; // 184 days before asOf

  /** An active transfer that owes the whole card balance unless told otherwise. */
  const transfer = (overrides: Partial<ActiveTransfer> = {}): ActiveTransfer => {
    const base = row(overrides);
    return { ...base, owed: Math.max(0, -base.balance), aheadOfIt: 0, ...overrides };
  };

  /** Card 9's history, holding the two window starts for the given paces. */
  const history = (paceThree: number, paceRange: number, end = -4200) =>
    new Map([
      [
        9,
        [
          { date: rangeStart, balance: startFor(end, paceRange, 184) },
          { date: threeMonthStart, balance: startFor(end, paceThree, 92) },
        ],
      ],
    ]);

  it("reproduces #417's worked example at 0%", () => {
    const [tracked] = buildBalanceTransferTracker([transfer()], history(300, 500), rangeStart);

    expect(tracked.owed).toBe(4200);
    expect(tracked.aheadOfIt).toBe(0);
    expect(tracked.accountTypeId).toBe(15);
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
    expect(tracked.transfer).toMatchObject({
      sourceAccountName: "Card A",
      transferredAmount: 6000,
      feeAmount: 180,
      promoApr: 0,
    });
  });

  it("uses the 3-month pace for the projection and status, not the range pace", () => {
    // A strong range pace does not rescue a weak 3-month pace.
    const [tracked] = buildBalanceTransferTracker([transfer()], history(300, 900), rangeStart);
    expect(tracked.status.kind).toBe("behind");
    expect(tracked.projectedAtExpiry).toBeCloseTo(600, 6);
  });

  it("accounts for a promo rate above 0%", () => {
    const [tracked] = buildBalanceTransferTracker(
      [transfer({ promoApr: 3.99 })],
      history(300, 500),
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
    const [tracked] = buildBalanceTransferTracker(
      [transfer({ postingDate, feeDate: "2026-09-04", balance: -6180 })],
      new Map([[9, [{ date: postingDate, balance: -6000 }]]]),
      "2026-01-01"
    );
    expect(tracked.threeMonthPace).toBeCloseTo(0, 10);
    expect(tracked.rangePace).toBeCloseTo(0, 10);
  });

  it("shows no range pace for a range under 30 days, and keeps the 3-month pace", () => {
    const shortRange = "2026-10-20";
    const [tracked] = buildBalanceTransferTracker(
      [transfer()],
      new Map([
        [
          9,
          [
            { date: threeMonthStart, balance: startFor(-4200, 300, 92) },
            { date: shortRange, balance: -4300 },
          ],
        ],
      ]),
      shortRange
    );
    expect(tracked.rangePace).toBeNull();
    expect(tracked.threeMonthPace).toBeCloseTo(300, 8);
  });

  it("is too new to project in a promo's first 30 days", () => {
    const postingDate = "2026-10-25";
    const [tracked] = buildBalanceTransferTracker(
      [transfer({ postingDate, feeDate: null, feeAmount: null, feeTransactionId: null })],
      new Map([[9, [{ date: postingDate, balance: -6000 }]]]),
      "2026-01-01"
    );
    expect(tracked.threeMonthPace).toBeNull();
    expect(tracked.projectedAtExpiry).toBeNull();
    expect(tracked.status).toEqual({ kind: "too_new" });
    expect(tracked.transfer.feeAmount).toBeNull();
  });

  it("gives a missing start balance a null pace", () => {
    const [tracked] = buildBalanceTransferTracker([transfer()], new Map(), rangeStart);
    expect(tracked.threeMonthPace).toBeNull();
    expect(tracked.rangePace).toBeNull();
  });

  it("reads a transfer with nothing left as paid off, with nothing to measure", () => {
    // A card in credit owes nothing on its transfer.
    const [tracked] = buildBalanceTransferTracker(
      [transfer({ balance: 25, promoEndDate: "2026-12-01" })],
      history(300, 500, 25),
      rangeStart
    );
    expect(tracked).toMatchObject({
      owed: 0,
      requiredPerMonth: null,
      threeMonthPace: null,
      rangePace: null,
      projectedAtExpiry: null,
      monthlyInterest: null,
      status: { kind: "paid_off" },
    });
  });

  it("caps Left at expiry at what is left on the transfer", () => {
    // The debt is growing, so the projection exceeds the balance. The excess is
    // new charges, which revert as nothing: they were never promotional.
    const [tracked] = buildBalanceTransferTracker([transfer()], history(-100, -100), rangeStart);
    expect(tracked.projectedAtExpiry).toBe(4200);
    expect(tracked.status.kind).toBe("behind");
    if (tracked.status.kind === "behind") {
      expect(tracked.status.shortPerMonth).toBeCloseTo(450, 6);
    }
  });

  it("counts debt paid ahead of a transfer in its Needed / mo, and charges interest on its own balance", () => {
    // $1,200 of purchases on the card, paid before the transfer.
    const [tracked] = buildBalanceTransferTracker(
      [transfer({ promoApr: 3.99, owed: 3000, aheadOfIt: 1200 })],
      history(300, 500),
      rangeStart
    );
    expect(tracked.requiredPerMonth).toBeCloseTo(requiredPayment(4200, 3.99, 12), 10);
    expect(tracked.monthlyInterest).toBeCloseTo(3000 * (0.0399 / 12), 10);
  });

  // Issue #427's worked example. A card with no other balance took $4,000 +
  // $120 ending in a month and $10,000 + $300 ending in four.
  describe("#427's worked example", () => {
    const first = (overrides: Partial<ActiveTransfer>) =>
      transfer({
        balanceTransferId: 1,
        postingDate: "2026-01-10",
        postingAmount: -4000,
        feeAmount: -120,
        feeDate: "2026-01-12",
        promoEndDate: "2026-12-10",
        ...overrides,
      });
    const second = (overrides: Partial<ActiveTransfer>) =>
      transfer({
        balanceTransferId: 2,
        postingTransactionId: 200,
        postingDate: "2026-01-10",
        postingAmount: -10000,
        feeTransactionId: 201,
        feeAmount: -300,
        feeDate: "2026-01-12",
        promoEndDate: "2027-03-10",
        ...overrides,
      });

    it("paid down to $8,000: the first is paid off, and the second sets the pace", () => {
      const tracker = buildBalanceTransferTracker(
        [
          first({ balance: -8000, owed: 0 }),
          second({ balance: -8000, owed: 8000 }),
        ],
        history(1500, 1500, -8000),
        rangeStart
      );

      expect(tracker.map((t) => t.transfer.balanceTransferId)).toEqual([1, 2]);
      expect(tracker[0]).toMatchObject({
        owed: 0,
        requiredPerMonth: null,
        threeMonthPace: null,
        projectedAtExpiry: null,
        status: { kind: "paid_off" },
      });
      expect(tracker[1]).toMatchObject({
        owed: 8000,
        monthsRemaining: 4,
        requiredPerMonth: 2000,
      });
      expect(tracker[1].projectedAtExpiry).toBeCloseTo(2000, 6);
      // Judged on the second promo's dates, by pace: $1,500 against $2,000.
      expect(tracker[1].status.kind).toBe("behind");
    });

    it("at $12,000 owed: $3,000 a month clears both", () => {
      const tracker = buildBalanceTransferTracker(
        [
          first({ balance: -12000, owed: 1700 }),
          second({ balance: -12000, owed: 10300, aheadOfIt: 1700 }),
        ],
        history(3000, 3000, -12000),
        rangeStart
      );

      expect(tracker[0]).toMatchObject({
        owed: 1700,
        monthsRemaining: 1,
        requiredPerMonth: 1700,
        projectedAtExpiry: 0,
        status: { kind: "expiring", daysLeft: 30 },
      });
      expect(tracker[1]).toMatchObject({
        owed: 10300,
        aheadOfIt: 1700,
        requiredPerMonth: 3000,
        projectedAtExpiry: 0,
        status: { kind: "on_track" },
      });
      // Pace is the card's, on each of its rows.
      expect(tracker[0].threeMonthPace).toBeCloseTo(3000, 8);
      expect(tracker[1].threeMonthPace).toBeCloseTo(3000, 8);
    });
  });

  it("orders cards by their next deadline with a balance, all-paid-off cards last", () => {
    const tracker = buildBalanceTransferTracker(
      [
        transfer({ accountId: 20, balanceTransferId: 6, promoEndDate: "2028-06-01" }),
        transfer({ accountId: 20, balanceTransferId: 5, promoEndDate: "2027-01-01", owed: 0 }),
        transfer({ accountId: 22, balanceTransferId: 8, promoEndDate: "2026-12-20", owed: 0 }),
        transfer({ accountId: 21, balanceTransferId: 7, promoEndDate: "2027-06-01" }),
      ],
      new Map(),
      rangeStart
    );
    // Card 21's next deadline (Jun 2027) beats card 20's (Jun 2028), whose
    // paid-off Jan 2027 promo is not due. Card 22 has nothing left to pay.
    expect(tracker.map((t) => [t.accountId, t.transfer.balanceTransferId])).toEqual([
      [21, 7],
      [20, 5],
      [20, 6],
      [22, 8],
    ]);
  });
});
