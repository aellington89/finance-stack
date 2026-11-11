import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    // And no trend icon: there is no direction to show.
    expect(cells[3].querySelector("svg")).toBeNull();
  });

  it("colours a paydown as a gain and shows the signed change", () => {
    render(<LiabilityPerformanceTable data={data} />);

    const catRow = screen.getByTestId("row-cat:5");
    const change = within(catRow).getByText("+$1,000.00");
    expect(change).toHaveClass("text-green-600");
    expect(change.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
  });

  it("expands and collapses from the keyboard, reporting the state", async () => {
    const user = userEvent.setup();
    render(<LiabilityPerformanceTable data={data} />);

    // Tab rather than .focus(): being reachable by Tab is the point.
    await user.tab();
    const toggle = screen.getByRole("button", {
      name: "Current Liability",
      expanded: false,
    });
    expect(toggle).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Credit Card")).toBeInTheDocument();

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Credit Card")).not.toBeInTheDocument();
  });

  it("renders each row only once across repeated renders in one file", () => {
    // Guards the explicit afterEach(cleanup) in tests/jsdom/vitest-setup.ts:
    // without it the previous test's tree is still mounted here and this
    // getByTestId throws on multiple matches.
    render(<LiabilityPerformanceTable data={data} />);
    expect(screen.getByTestId("row-cat:5")).toBeInTheDocument();
  });
});

// Issue #417: an account on an active balance-transfer promo carries a badge
// naming the rate and its end date, in text, with the icon hidden.
describe("LiabilityPerformanceTable — promo badge", () => {
  const withPromo = (apr: number): LiabilityPerformanceData => {
    const copy = structuredClone(data);
    copy.categories[0].accountTypes[0].accounts[0].activePromo = {
      apr,
      endDate: "2027-03-14",
    };
    return copy;
  };

  const openAccounts = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Current Liability" }));
    await user.click(screen.getByRole("button", { name: "Credit Card" }));
  };

  it("badges a promotional account with its rate and end date", async () => {
    render(<LiabilityPerformanceTable data={withPromo(0)} />);
    await openAccounts();

    const row = screen.getByTestId("row-acc:42");
    expect(within(row).getByText("Visa ...1234")).toBeInTheDocument();
    expect(row).toHaveTextContent("0% until Mar 14, 2027");
    expect(row.querySelector("svg.lucide-badge-percent")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a non-zero promo rate as stated", async () => {
    render(<LiabilityPerformanceTable data={withPromo(3.99)} />);
    await openAccounts();
    expect(screen.getByTestId("row-acc:42")).toHaveTextContent("3.99% until Mar 14, 2027");
  });

  it("shows no badge on an account without a promo", async () => {
    render(<LiabilityPerformanceTable data={data} />);
    await openAccounts();
    expect(screen.getByTestId("row-acc:42")).not.toHaveTextContent("until");
  });
});
