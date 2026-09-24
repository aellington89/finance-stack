import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DebtServiceSummary } from "@/components/dashboard/debt-service-summary";
import type { DebtServiceData } from "@/lib/queries/liabilities-drilldown";

// Sign convention: payments positive, interestAccrued negative, and
// principalPaid = totalPayments + interestAccrued.
const data: DebtServiceData = {
  totalPayments: 1000,
  interestAccrued: -250,
  principalPaid: 750,
  categories: [
    {
      categoryId: 5,
      categoryName: "Current Liability",
      totalPayments: 1000,
      interestAccrued: -250,
      principalPaid: 750,
      accountTypes: [
        {
          accountTypeId: 15,
          accountTypeName: "Credit Card",
          totalPayments: 1000,
          interestAccrued: -250,
          principalPaid: 750,
          accounts: [
            {
              accountId: 42,
              accountName: "Visa ...1234",
              totalPayments: 1000,
              interestAccrued: -250,
              principalPaid: 750,
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("scrollBy", vi.fn());
});

describe("DebtServiceSummary", () => {
  it("shows interest as a positive cost rather than the negative it is stored as", () => {
    render(<DebtServiceSummary data={data} />);

    expect(screen.getByText("Interest Accrued")).toBeInTheDocument();
    // -250 is displayed as $250.00, never as -$250.00.
    expect(screen.queryByText("-$250.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("$250.00").length).toBeGreaterThan(0);
  });

  it("renders the three summary tiles", () => {
    render(<DebtServiceSummary data={data} />);

    for (const label of [
      "Total Payments",
      "Interest Accrued",
      "Principal Paid (estimated)",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("expresses interest and principal as a share of payments", () => {
    render(<DebtServiceSummary data={data} />);

    // 250/1000 and 750/1000.
    expect(screen.getAllByText("25.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("75.0%").length).toBeGreaterThan(0);
  });

  // formatPctOfPayment guards a divide-by-zero: interest can accrue in a
  // period with no payments at all, and 0/0 must not render as NaN%.
  it("renders an em-dash rather than NaN when there were no payments", () => {
    render(
      <DebtServiceSummary
        data={{
          totalPayments: 0,
          interestAccrued: -100,
          principalPaid: -100,
          categories: [
            {
              categoryId: 5,
              categoryName: "Current Liability",
              totalPayments: 0,
              interestAccrued: -100,
              principalPaid: -100,
              accountTypes: [],
            },
          ],
        }}
      />
    );

    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the empty state when there is no activity at all", () => {
    render(
      <DebtServiceSummary
        data={{
          totalPayments: 0,
          interestAccrued: 0,
          principalPaid: 0,
          categories: [],
        }}
      />
    );

    expect(
      screen.getByText("No payment or interest activity in the selected range.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Total Payments")).not.toBeInTheDocument();
  });

  it("drills from category to account type to account", async () => {
    const user = userEvent.setup();
    render(<DebtServiceSummary data={data} />);

    expect(screen.queryByText("Credit Card")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("row-cat:5"));
    expect(screen.getByText("Credit Card")).toBeInTheDocument();

    await user.click(screen.getByTestId("row-type:5:15"));
    expect(screen.getByText("Visa ...1234")).toBeInTheDocument();
  });

  it("keeps a totals footer alongside the category rows", () => {
    render(<DebtServiceSummary data={data} />);
    const footerTotal = screen.getByText("Total").closest("tr")!;
    expect(within(footerTotal).getByText("$1,000.00")).toBeInTheDocument();
  });
});
