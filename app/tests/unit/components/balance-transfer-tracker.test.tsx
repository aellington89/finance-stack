import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  BalanceTransferTracker,
  statusText,
} from "@/components/dashboard/balance-transfer-tracker";
import type { BalanceTransferTrackerRow } from "@/lib/queries/balance-transfer-payoff";

// Issue #417. The math is tested in balance-transfer-payoff.test.ts; this pins
// what the card shows for it. All figures synthetic.

const row = (overrides: Partial<BalanceTransferTrackerRow> = {}): BalanceTransferTrackerRow => ({
  accountId: 9,
  accountName: "Card B",
  asOf: "2026-11-10",
  balance: -4200,
  debt: 4200,
  primary: {
    balanceTransferId: 1,
    sourceAccountName: "Card A",
    postingDate: "2025-11-10",
    transferredAmount: 6000,
    promoEndDate: "2027-11-10",
    promoApr: 0,
    feeAmount: 180,
  },
  others: [],
  monthsRemaining: 12,
  daysLeft: 365,
  monthlyInterest: null,
  requiredPerMonth: 350,
  threeMonthPace: 300,
  rangePace: 500,
  projectedAtExpiry: 600,
  status: { kind: "behind", shortPerMonth: 50 },
  ...overrides,
});

describe("statusText", () => {
  it.each([
    [{ kind: "on_track" } as const, "On track"],
    [{ kind: "behind", shortPerMonth: 50 } as const, "Behind — $50.00/mo short"],
    [{ kind: "expiring", daysLeft: 45 } as const, "Expires in 45 days"],
    [{ kind: "expiring", daysLeft: 1 } as const, "Expires in 1 day"],
    [{ kind: "too_new" } as const, "Too new to project"],
  ])("words %o as %s", (status, expected) => {
    expect(statusText(status)).toBe(expected);
  });
});

describe("BalanceTransferTracker", () => {
  it("renders the issue's worked example", () => {
    render(<BalanceTransferTracker rows={[row()]} />);
    const tr = screen.getByTestId("balance-transfer-row-9");
    const cells = within(tr).getAllByRole("cell").map((c) => c.textContent);

    expect(cells).toEqual([
      "Card B$6,000.00 from Card A, fee $180.00",
      "0% until Nov 10, 202712 months left",
      "$4,200.00",
      "$350.00",
      "3 mo $300.00range $500.00",
      "$600.00",
      "Behind — $50.00/mo short",
    ]);
    expect(screen.getByText(/Promos active on Nov 10, 2026/)).toBeInTheDocument();
  });

  it("shows External, no fee, a dash for a short range, and the promo interest above 0%", () => {
    render(
      <BalanceTransferTracker
        rows={[
          row({
            primary: { ...row().primary, sourceAccountName: null, feeAmount: null, promoApr: 3.99 },
            monthlyInterest: 13.97,
            rangePace: null,
            monthsRemaining: 1,
          }),
        ]}
      />
    );
    const tr = screen.getByTestId("balance-transfer-row-9");
    expect(tr).toHaveTextContent("$6,000.00 from External, no fee linked");
    expect(tr).toHaveTextContent("3.99% until Nov 10, 20271 month left, $13.97/mo interest");
    expect(tr).toHaveTextContent("range —");
  });

  it("lists a card's other active transfers under it", () => {
    render(
      <BalanceTransferTracker
        rows={[
          row({
            others: [
              {
                balanceTransferId: 2,
                sourceAccountName: "Card C",
                postingDate: "2026-06-01",
                transferredAmount: 1500,
                promoEndDate: "2028-06-01",
                promoApr: 0,
                feeAmount: null,
              },
            ],
          }),
        ]}
      />
    );
    expect(screen.getByTestId("balance-transfer-row-9")).toHaveTextContent(
      "Also $1,500.00 from Card C, no fee linked, 0% until Jun 1, 2028"
    );
  });

  it("hides the status icon from assistive tech, leaving the words", () => {
    render(<BalanceTransferTracker rows={[row({ status: { kind: "on_track" } })]} />);
    const cell = within(screen.getByTestId("balance-transfer-row-9")).getByText("On track");
    expect(cell.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
