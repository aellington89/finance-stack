import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetPerformanceTable } from "@/components/dashboard/asset-performance-table";
import type { PerformanceData } from "@/lib/queries/assets-drilldown";

// Note the asymmetry with the liability side: here percentChange is `number`,
// not `number | null`, so this table has no em-dash path to cover.
const data: PerformanceData = {
  totalCurrentValue: 11_000,
  totalStartValue: 10_000,
  totalChange: 1_000,
  totalPercentChange: 10,
  categories: [
    {
      categoryId: 1,
      categoryName: "Current Asset",
      currentValue: 11_000,
      startValue: 10_000,
      change: 1_000,
      percentChange: 10,
      percentOfTotal: 100,
      accountTypes: [
        {
          accountTypeId: 2,
          accountTypeName: "Checking",
          currentValue: 11_000,
          startValue: 10_000,
          change: 1_000,
          percentChange: 10,
          percentOfParent: 100,
          percentOfTotal: 100,
          accounts: [
            {
              accountId: 7,
              accountName: "Everyday",
              currentValue: 11_000,
              startValue: 10_000,
              change: 1_000,
              percentChange: 10,
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
  vi.stubGlobal("scrollBy", vi.fn());
});

describe("AssetPerformanceTable", () => {
  it("renders one collapsed row per category", () => {
    render(<AssetPerformanceTable data={data} />);

    expect(screen.getByText("Current Asset")).toBeInTheDocument();
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  });

  it("signs the change and shows the percent", () => {
    render(<AssetPerformanceTable data={data} />);

    const catRow = screen.getByTestId("row-cat:1");
    expect(catRow).toHaveTextContent("+$1,000.00");
    expect(catRow).toHaveTextContent("+10.00%");

    // Icon and colour on the one element: Issue #144's "icon + colour".
    for (const text of ["+$1,000.00", "+10.00%"]) {
      const change = within(catRow).getByText(text);
      expect(change).toHaveClass("text-green-600");
      expect(change.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
    }
  });

  it("drills from category to account type to account", async () => {
    const user = userEvent.setup();
    render(<AssetPerformanceTable data={data} />);

    await user.click(screen.getByTestId("row-cat:1"));
    expect(screen.getByText("Checking")).toBeInTheDocument();

    await user.click(screen.getByTestId("row-type:1:2"));
    expect(screen.getByText("Everyday")).toBeInTheDocument();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    render(<AssetPerformanceTable data={data} />);

    await user.click(screen.getByTestId("row-cat:1"));
    await user.click(screen.getByTestId("row-cat:1"));
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  });

  it("colours a decline red", () => {
    render(
      <AssetPerformanceTable
        data={{
          ...data,
          totalChange: -500,
          totalPercentChange: -5,
          categories: [
            {
              ...data.categories[0],
              change: -500,
              percentChange: -5,
            },
          ],
        }}
      />
    );

    const catRow = screen.getByTestId("row-cat:1");
    const change = within(catRow).getByText("-$500.00");
    expect(change).toHaveClass("text-red-600");
    expect(change.querySelector("svg.lucide-trending-down")).toBeInTheDocument();
  });

  it("expands and collapses from the keyboard, reporting the state", async () => {
    const user = userEvent.setup();
    render(<AssetPerformanceTable data={data} />);

    // Tab rather than .focus(): being reachable by Tab is the point.
    await user.tab();
    const toggle = screen.getByRole("button", {
      name: "Current Asset",
      expanded: false,
    });
    expect(toggle).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Checking")).toBeInTheDocument();

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  });
});
