import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetPerformanceTable } from "@/components/dashboard/asset-performance-table";
import type { PerformanceData } from "@/lib/queries/assets-drilldown";

// percentChange is `number | null` here as on the liability side since Issue
// #143: null (a zero start balance) renders as an em-dash — see the test below.
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
      expect(change).toHaveClass("text-gain");
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
    expect(change).toHaveClass("text-loss");
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

  // Issue #143. An account opened mid-range has a zero start balance, so its
  // % change is undefined. It used to read 0.00%; it must read "—", with no
  // colour and no trend icon, at every level and in the footer.
  it("renders an em-dash for a null percent change", async () => {
    const user = userEvent.setup();
    const cat = data.categories[0];
    const type = cat.accountTypes[0];
    render(
      <AssetPerformanceTable
        data={{
          ...data,
          totalStartValue: 0,
          totalPercentChange: null,
          categories: [
            {
              ...cat,
              startValue: 0,
              percentChange: null,
              accountTypes: [
                {
                  ...type,
                  startValue: 0,
                  percentChange: null,
                  accounts: [
                    { ...type.accounts[0], startValue: 0, percentChange: null },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );
    await user.click(screen.getByTestId("row-cat:1"));
    await user.click(screen.getByTestId("row-type:1:2"));

    // Columns are Name | Value | Change | % Change | % of Total. Assert on the
    // % Change cell itself: the row's "100.00%" in % of Total contains
    // "0.00%" as a substring.
    const rows = [
      screen.getByTestId("row-cat:1"),
      screen.getByTestId("row-type:1:2"),
      screen.getByTestId("row-acc:7"),
      screen.getByText("Total").closest("tr") as HTMLElement,
    ];
    for (const tr of rows) {
      const cell = tr.querySelectorAll("td")[3];
      expect(cell).toHaveTextContent("—");
      expect(cell.textContent).not.toContain("%");
      expect(cell.querySelector("svg")).toBeNull();
      expect(cell.querySelector(".text-gain, .text-loss")).toBeNull();
    }
  });

  // Issue #143. -$100 → +$50 is a gain; % change against |start| keeps that
  // sign, so it reads +150.00% in green with an up arrow, not -150.00% in red.
  it("draws an overdrawn account's recovery as a gain", () => {
    const cat = data.categories[0];
    render(
      <AssetPerformanceTable
        data={{
          ...data,
          totalCurrentValue: 50,
          totalStartValue: -100,
          totalChange: 150,
          totalPercentChange: 150,
          categories: [
            {
              ...cat,
              currentValue: 50,
              startValue: -100,
              change: 150,
              percentChange: 150,
            },
          ],
        }}
      />
    );

    const pctCell = screen.getByTestId("row-cat:1").querySelectorAll("td")[3];
    const figure = within(pctCell).getByText("+150.00%");
    expect(figure).toHaveClass("text-gain");
    expect(figure.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
  });
});
