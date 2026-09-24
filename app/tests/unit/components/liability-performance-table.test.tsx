import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiabilityPerformanceTable } from "@/components/dashboard/liability-performance-table";
import type { LiabilityPerformanceData } from "@/lib/queries/liabilities-drilldown";

const data: LiabilityPerformanceData = {
  totalCurrentValue: -5000,
  totalStartValue: -6000,
  totalChange: 1000,
  totalPercentChange: 16.67,
  categories: [
    {
      categoryId: 5,
      categoryName: "Current Liability",
      currentValue: -5000,
      startValue: -6000,
      change: 1000,
      percentChange: 16.67,
      percentOfTotal: 100,
      accountTypes: [
        {
          accountTypeId: 15,
          accountTypeName: "Credit Card",
          currentValue: -5000,
          startValue: -6000,
          change: 1000,
          // Opened mid-period: the query cannot express a percent change.
          percentChange: null,
          percentOfParent: 100,
          percentOfTotal: 100,
          accounts: [
            {
              accountId: 42,
              accountName: "Visa ...1234",
              currentValue: -5000,
              startValue: -6000,
              change: 1000,
              percentChange: 16.67,
              percentOfParent: 100,
              percentOfTotal: 100,
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  // The row-anchoring useLayoutEffect calls this after every toggle; jsdom has
  // no layout, so getBoundingClientRect is all zeros and the delta is 0.
  vi.stubGlobal("scrollBy", vi.fn());
});

describe("LiabilityPerformanceTable", () => {
  it("renders one collapsed row per category", () => {
    render(<LiabilityPerformanceTable data={data} />);

    expect(screen.getByText("Liability Performance")).toBeInTheDocument();
    expect(screen.getByText("Current Liability")).toBeInTheDocument();
    // Account types stay hidden until the category is opened.
    expect(screen.queryByText("Credit Card")).not.toBeInTheDocument();
  });

  it("expands a category on click and collapses it again", async () => {
    const user = userEvent.setup();
    render(<LiabilityPerformanceTable data={data} />);

    await user.click(screen.getByTestId("row-cat:5"));
    expect(screen.getByText("Credit Card")).toBeInTheDocument();

    await user.click(screen.getByTestId("row-cat:5"));
    expect(screen.queryByText("Credit Card")).not.toBeInTheDocument();
  });

  it("drills through account type to account", async () => {
    const user = userEvent.setup();
    render(<LiabilityPerformanceTable data={data} />);

    await user.click(screen.getByTestId("row-cat:5"));
    expect(screen.queryByText("Visa ...1234")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("row-type:5:15"));
    expect(screen.getByText("Visa ...1234")).toBeInTheDocument();
  });

  // The reason formatPercentChange exists: a null must not read as 0.00%.
  it("renders an em-dash for a null percent change", async () => {
    const user = userEvent.setup();
    render(<LiabilityPerformanceTable data={data} />);
    await user.click(screen.getByTestId("row-cat:5"));

    // Columns are Name | Balance | Change | % Change | % of Total. Assert on
    // the % Change cell specifically: a whole-row match would also see the
    // "100.00%" in % of Total, which contains "0.00%" as a substring.
    const cells = screen.getByTestId("row-type:5:15").querySelectorAll("td");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[3].textContent).not.toContain("%");
  });

  it("colours a paydown as a gain and shows the signed change", () => {
    render(<LiabilityPerformanceTable data={data} />);

    const catRow = screen.getByTestId("row-cat:5");
    expect(catRow).toHaveTextContent("+$1,000.00");
    expect(catRow.innerHTML).toContain("text-green-600");
  });

  it("renders each row only once across repeated renders in one file", () => {
    // Guards the explicit afterEach(cleanup) in tests/jsdom/vitest-setup.ts:
    // without it the previous test's tree is still mounted here and this
    // getByTestId throws on multiple matches.
    render(<LiabilityPerformanceTable data={data} />);
    expect(screen.getByTestId("row-cat:5")).toBeInTheDocument();
  });
});
