import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetWorthDriversTable } from "@/components/dashboard/net-worth-drivers-table";
import type { DriversData } from "@/lib/queries/net-worth-drilldown";

const data: DriversData = {
  totalChange: 4000,
  categories: [
    {
      categoryId: 1,
      categoryName: "Current Asset",
      change: 5000,
      percentOfTotal: 125,
      accountTypes: [
        {
          accountTypeId: 2,
          accountTypeName: "Checking",
          change: 5000,
          percentOfParent: 100,
          percentOfTotal: 125,
          accounts: [
            {
              accountId: 7,
              accountName: "Everyday",
              change: 5000,
              percentOfParent: 100,
              percentOfTotal: 125,
            },
          ],
        },
      ],
    },
    {
      categoryId: 5,
      categoryName: "Current Liability",
      change: -1000,
      percentOfTotal: -25,
      accountTypes: [],
    },
  ],
};

// Rows carry no data-testid here (unlike liability-performance-table), so
// they are reached through the category or type name they display.
const row = (text: string): HTMLElement =>
  screen.getByText(text).closest("tr") as HTMLElement;

beforeEach(() => {
  vi.stubGlobal("scrollBy", vi.fn());
});

describe("NetWorthDriversTable", () => {
  it("renders a row per driver category", () => {
    render(<NetWorthDriversTable data={data} />);

    expect(screen.getByText("Current Asset")).toBeInTheDocument();
    expect(screen.getByText("Current Liability")).toBeInTheDocument();
  });

  it("signs the change and colours gains and losses differently", () => {
    render(<NetWorthDriversTable data={data} />);

    const gain = screen.getByText("Current Asset").closest("tr")!;
    expect(within(gain).getByText("+$5,000.00")).toBeInTheDocument();
    expect(gain.innerHTML).toContain("text-green-600");

    const loss = screen.getByText("Current Liability").closest("tr")!;
    expect(within(loss).getByText("-$1,000.00")).toBeInTheDocument();
    expect(loss.innerHTML).toContain("text-red-600");
  });

  it("renders a share over 100% as-is rather than clamping it", () => {
    // A category can exceed the net total when another moves the other way,
    // which is exactly the case this fixture encodes.
    render(<NetWorthDriversTable data={data} />);
    const gain = screen.getByText("Current Asset").closest("tr")!;
    expect(within(gain).getByText("+125.00%")).toBeInTheDocument();
  });

  it("drills from category to account type to account", async () => {
    const user = userEvent.setup();
    render(<NetWorthDriversTable data={data} />);

    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
    await user.click(row("Current Asset"));
    expect(screen.getByText("Checking")).toBeInTheDocument();

    await user.click(row("Checking"));
    expect(screen.getByText("Everyday")).toBeInTheDocument();
  });

  it("collapsing a category hides its descendants again", async () => {
    const user = userEvent.setup();
    render(<NetWorthDriversTable data={data} />);

    await user.click(row("Current Asset"));
    await user.click(row("Current Asset"));
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  });

  it("shows the net total in the footer", () => {
    render(<NetWorthDriversTable data={data} />);
    // Exact match: the header carries a "% of Total" cell that a substring
    // match would also hit.
    const footer = screen.getByText("Total").closest("tr")!;
    expect(within(footer).getByText("+$4,000.00")).toBeInTheDocument();
  });
});
