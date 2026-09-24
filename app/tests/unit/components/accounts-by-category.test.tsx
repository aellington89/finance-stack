import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountsByCategory } from "@/components/accounts/accounts-by-category";
import type { AccountListRow } from "@/lib/queries/accounts";

const acct = (
  accountId: number,
  accountName: string,
  accountType: string,
  accountTypeId: number,
  accountTypeCategory: string,
  balance = 100
): AccountListRow => ({
  accountId,
  accountName,
  accountTypeId,
  accountType,
  accountTypeCategory,
  accountIdentifier: null,
  openedDate: null,
  closedDate: null,
  balance,
});

// groupByCategory is a run-length grouper: it only starts a new group when the
// category or type *changes*, so it relies on the query returning rows already
// ordered by category then type. These fixtures respect that contract.
const rows: AccountListRow[] = [
  acct(1, "Everyday", "Checking", 10, "Current Asset", 1500),
  acct(2, "Bills", "Checking", 10, "Current Asset", 500),
  acct(3, "Rainy Day", "Savings", 11, "Current Asset", 9000),
  acct(4, "Visa", "Credit Card", 20, "Current Liability", -300),
];

describe("AccountsByCategory", () => {
  it("groups accounts under their category and type", () => {
    render(<AccountsByCategory accounts={rows} />);

    expect(screen.getByText("Current Asset")).toBeInTheDocument();
    expect(screen.getByText("Current Liability")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    for (const name of ["Everyday", "Bills", "Rainy Day", "Visa"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("keeps two accounts of the same type in one type group", () => {
    render(<AccountsByCategory accounts={rows} />);
    // Checking appears once as a heading even though it holds two accounts.
    expect(screen.getAllByText("Checking")).toHaveLength(1);
  });

  it("formats balances as currency", () => {
    render(<AccountsByCategory accounts={rows} />);
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    expect(screen.getByText("-$300.00")).toBeInTheDocument();
  });

  it("links each account to its detail page", () => {
    render(<AccountsByCategory accounts={rows} />);
    const link = screen.getByRole("link", { name: /Everyday/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("1"));
  });

  it("starts a new group when the category repeats after another", () => {
    // Run-length grouping means an out-of-order row opens a *second* group for
    // the same category rather than merging. Pinning the real behaviour so a
    // future switch to a Map-based grouper is a visible change.
    render(
      <AccountsByCategory
        accounts={[
          acct(1, "A", "Checking", 10, "Current Asset"),
          acct(2, "B", "Credit Card", 20, "Current Liability"),
          acct(3, "C", "Checking", 10, "Current Asset"),
        ]}
      />
    );
    expect(screen.getAllByText("Current Asset")).toHaveLength(2);
  });

  it("renders nothing but the shell for an empty account list", () => {
    render(<AccountsByCategory accounts={[]} />);
    expect(screen.queryByText("Current Asset")).not.toBeInTheDocument();
  });
});
