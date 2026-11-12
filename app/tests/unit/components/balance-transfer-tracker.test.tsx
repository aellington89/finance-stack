import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  BalanceTransferTracker,
  statusText,
} from "@/components/dashboard/balance-transfer-tracker";
import type { BalanceTransferTrackerRow } from "@/lib/queries/balance-transfer-payoff";

// Issues #417 and #427. The math is tested in balance-transfer-payoff.test.ts;
// this pins what the card shows for it. All figures synthetic.

const row = (overrides: Partial<BalanceTransferTrackerRow> = {}): BalanceTransferTrackerRow => ({
  accountId: 9,
  accountName: "Card B",
  accountTypeId: 15,
  asOf: "2026-11-10",
  transfer: {
    balanceTransferId: 1,
    sourceAccountName: "Card A",
    postingDate: "2025-11-10",
    transferredAmount: 6000,
    promoEndDate: "2027-11-10",
    promoApr: 0,
    feeAmount: 180,
  },
  owed: 4200,
  aheadOfIt: 0,
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
    [{ kind: "paid_off" } as const, "Paid off"],
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
    const tr = screen.getByTestId("balance-transfer-row-1");
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
            transfer: { ...row().transfer, sourceAccountName: null, feeAmount: null, promoApr: 3.99 },
            monthlyInterest: 13.97,
            rangePace: null,
            monthsRemaining: 1,
          }),
        ]}
      />
    );
    const tr = screen.getByTestId("balance-transfer-row-1");
    expect(tr).toHaveTextContent("$6,000.00 from External, no fee linked");
    expect(tr).toHaveTextContent("3.99% until Nov 10, 20271 month left, $13.97/mo interest");
    expect(tr).toHaveTextContent("range —");
  });

  it("gives each of a card's transfers its own row, keyed by transfer", () => {
    render(
      <BalanceTransferTracker
        rows={[
          row({ owed: 0, requiredPerMonth: null, status: { kind: "paid_off" } }),
          row({
            transfer: { ...row().transfer, balanceTransferId: 2, transferredAmount: 1500 },
            owed: 1500,
          }),
        ]}
      />
    );
    expect(screen.getByTestId("balance-transfer-row-1")).toHaveTextContent("Card B");
    expect(screen.getByTestId("balance-transfer-row-2")).toHaveTextContent(
      "Card B$1,500.00 from Card A"
    );
    // No "Also …" lines: each transfer speaks for itself.
    expect(screen.queryByText(/^Also /)).not.toBeInTheDocument();
  });

  it("shows a paid-off transfer with nothing left to measure", () => {
    render(
      <BalanceTransferTracker
        rows={[
          row({
            owed: 0,
            requiredPerMonth: null,
            threeMonthPace: null,
            rangePace: null,
            projectedAtExpiry: null,
            status: { kind: "paid_off" },
          }),
        ]}
      />
    );
    const cells = within(screen.getByTestId("balance-transfer-row-1"))
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(2)).toEqual(["$0.00", "—", "3 mo —range —", "—", "Paid off"]);
  });

  it("says how much of Needed / mo is paid ahead of the transfer", () => {
    render(
      <BalanceTransferTracker
        rows={[row({ owed: 10300, aheadOfIt: 1700, requiredPerMonth: 3000 })]}
      />
    );
    const tr = screen.getByTestId("balance-transfer-row-1");
    expect(tr).toHaveTextContent("$3,000.00incl. $1,700.00 paid first");
  });

  it("does not mention what is paid ahead when nothing is", () => {
    render(<BalanceTransferTracker rows={[row()]} />);
    expect(screen.queryByText(/paid first/)).not.toBeInTheDocument();
  });

  it("hides the status icon from assistive tech, leaving the words", () => {
    render(<BalanceTransferTracker rows={[row({ status: { kind: "on_track" } })]} />);
    const cell = within(screen.getByTestId("balance-transfer-row-1")).getByText("On track");
    expect(cell.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
