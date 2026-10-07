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

  it("signs the change and pairs each colour with a trend icon", () => {
    render(<NetWorthDriversTable data={data} />);

    // Icon and colour on the one element: Issue #144's "icon + colour".
    const gain = within(row("Current Asset")).getByText("+$5,000.00");
    expect(gain).toHaveClass("text-green-600");
    expect(gain.querySelector("svg.lucide-trending-up")).toBeInTheDocument();

    const loss = within(row("Current Liability")).getByText("-$1,000.00");
    expect(loss).toHaveClass("text-red-600");
    expect(loss.querySelector("svg.lucide-trending-down")).toBeInTheDocument();

    // The shares are signed changes too, so they carry the icon as well.
    const share = within(row("Current Liability")).getByText("-25.00%");
    expect(share.querySelector("svg.lucide-trending-down")).toBeInTheDocument();
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

  it("expands and collapses from the keyboard, reporting the state", async () => {
    const user = userEvent.setup();
    render(<NetWorthDriversTable data={data} />);

    // Tab rather than .focus(): being reachable by Tab is the point.
    await user.tab();
    const category = screen.getByRole("button", {
      name: "Current Asset",
      expanded: false,
    });
    expect(category).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(category).toHaveAttribute("aria-expanded", "true");
    expect(category).toHaveFocus();

    // The rows just revealed come next in the tab order.
    await user.tab();
    expect(screen.getByRole("button", { name: "Checking" })).toHaveFocus();

    await user.tab({ shift: true });
    await user.keyboard(" ");
    expect(category).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  });

  it("toggles once when the button itself is clicked, not once per handler", async () => {
    // The row has its own onClick. If the button's click reached it too, the
    // two toggles would cancel out and the row would never open.
    const user = userEvent.setup();
    render(<NetWorthDriversTable data={data} />);

    await user.click(screen.getByRole("button", { name: "Current Asset" }));
    expect(screen.getByText("Checking")).toBeInTheDocument();
  });

  it("puts a toggle on every row that expands and on no leaf", async () => {
    const user = userEvent.setup();
    render(<NetWorthDriversTable data={data} />);

    await user.click(row("Current Asset"));
    await user.click(row("Checking"));

    // Two categories and one account type; the account row is a leaf.
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(within(row("Everyday")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the net total in the footer", () => {
    render(<NetWorthDriversTable data={data} />);
    // Exact match: the header carries a "% of Total" cell that a substring
    // match would also hit.
    const footer = screen.getByText("Total").closest("tr")!;
    expect(within(footer).getByText("+$4,000.00")).toBeInTheDocument();
  });
});
