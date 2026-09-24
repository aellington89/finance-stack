import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsTable } from "@/components/accounts/accounts-table";
import type { AccountBalanceRow } from "@/lib/queries/accounts";

// The query is a GROUP BY ROLLUP, so the row set interleaves leaf rows with
// subtotal rows (account type subtotal = accountName null, category subtotal =
// accountType and accountName null) and one grand total with all three null.
// buildCategoryGroups is the thing that untangles that, so the fixture has to
// carry every row kind or the test proves nothing.
const rows: AccountBalanceRow[] = [
  {
    accountTypeCategory: "Current Asset",
    accountType: "Checking",
    accountName: "Everyday",
    balance: 1500,
  },
  {
    accountTypeCategory: "Current Asset",
    accountType: "Checking",
    accountName: "Bills",
    balance: 500,
  },
  {
    accountTypeCategory: "Current Asset",
    accountType: "Checking",
    accountName: null,
    balance: 2000,
  },
  {
    accountTypeCategory: "Current Asset",
    accountType: null,
    accountName: null,
    balance: 2000,
  },
  {
    accountTypeCategory: "Current Liability",
    accountType: "Credit Card",
    accountName: "Visa",
    balance: -300,
  },
  {
    accountTypeCategory: "Current Liability",
    accountType: "Credit Card",
    accountName: null,
    balance: -300,
  },
  {
    accountTypeCategory: "Current Liability",
    accountType: null,
    accountName: null,
    balance: -300,
  },
  { accountTypeCategory: null, accountType: null, accountName: null, balance: 1700 },
];

// CardTitle renders a div rather than an h-tag, so there is no heading role
// to query — the section is found by its title text and walked up to its card.
const section = (title: string): HTMLElement =>
  screen.getByText(title).closest("[data-slot='card']") as HTMLElement;

describe("AccountsTable", () => {
  it("splits the rollup into an asset and a liability section", () => {
    render(<AccountsTable data={rows} />);

    expect(section("Assets")).toBeInTheDocument();
    expect(section("Liabilities")).toBeInTheDocument();
  });

  it("uses the subtotal rows for the section totals rather than re-summing", () => {
    render(<AccountsTable data={rows} />);

    // Scoped to the footer: the category subtotal row shows the same figure,
    // so an unscoped getByText matches twice.
    const total = (label: string) =>
      screen.getByText(label).parentElement!.lastElementChild;

    expect(total("Total Assets")).toHaveTextContent("$2,000.00");
    expect(total("Total Liabilities")).toHaveTextContent("-$300.00");
  });

  it("keeps leaf accounts hidden until their group is expanded", () => {
    render(<AccountsTable data={rows} />);

    expect(screen.getByText("Current Asset")).toBeInTheDocument();
    expect(screen.queryByText("Everyday")).not.toBeInTheDocument();
  });

  it("drills from category to account type to account", async () => {
    const user = userEvent.setup();
    render(<AccountsTable data={rows} />);

    await user.click(screen.getByText("Current Asset"));
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.queryByText("Everyday")).not.toBeInTheDocument();

    await user.click(screen.getByText("Checking"));
    expect(screen.getByText("Everyday")).toBeInTheDocument();
    expect(screen.getByText("Bills")).toBeInTheDocument();
  });

  it("expands and collapses a whole section at once", async () => {
    const user = userEvent.setup();
    render(<AccountsTable data={rows} />);

    await user.click(
      within(section("Assets")).getByTitle("Expand all")
    );
    expect(screen.getByText("Everyday")).toBeInTheDocument();

    await user.click(
      within(section("Assets")).getByTitle("Collapse all")
    );
    expect(screen.queryByText("Everyday")).not.toBeInTheDocument();
  });

  it("expand-all on one section leaves the other alone", async () => {
    const user = userEvent.setup();
    render(<AccountsTable data={rows} />);

    await user.click(
      within(section("Assets")).getByTitle("Expand all")
    );
    expect(screen.getByText("Everyday")).toBeInTheDocument();
    // The liability tree is keyed separately and must not have opened.
    expect(screen.queryByText("Visa")).not.toBeInTheDocument();
  });

  it("renders nothing but empty sections for a rollup with only a grand total", () => {
    render(
      <AccountsTable
        data={[
          {
            accountTypeCategory: null,
            accountType: null,
            accountName: null,
            balance: 0,
          },
        ]}
      />
    );

    expect(section("Assets")).toBeInTheDocument();
    expect(screen.queryByText("Current Asset")).not.toBeInTheDocument();
  });
});
