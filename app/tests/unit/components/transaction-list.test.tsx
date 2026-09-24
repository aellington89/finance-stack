import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionList } from "@/components/transactions/transaction-list";
import {
  ALL_COLUMN_KEYS,
  VISIBLE_COLUMNS_COOKIE,
  parseVisibleColumnsCookie,
} from "@/components/transactions/transaction-columns";

// The edit row and delete dialog import the server actions, which reach
// lib/auth/guard → @/auth → next-auth, and next-auth does not resolve under
// vitest's jsdom environment. Cutting the chain at the action module is enough
// for both children.
vi.mock("@/lib/actions/transaction", () => ({
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

const transactions = [
  {
    transactionId: 1,
    transactionDescription: "Groceries",
    transactionDate: "2026-04-19",
    amount: "-82.31",
    accountId: 1,
    relatedAccountId: null,
    accountName: "Everyday",
    relatedAccountName: null,
    transactionType: "Expense",
    transactionTypeId: 3,
    transactionCategory: "Food",
    transactionCategoryId: 9,
    accountTypeCategory: "Current Asset",
  },
];

const props = {
  transactions,
  sortBy: undefined,
  sortDir: undefined,
  page: 1,
  pageSize: 50,
  totalCount: 1,
  accounts: [{ id: 1, name: "Everyday" }],
  types: [{ id: 3, name: "Expense" }],
  categories: [{ id: 9, name: "Food" }],
  visibleColumns: ALL_COLUMN_KEYS,
};

beforeEach(() => {
  // toggleColumn persists through document.cookie; clear it between tests so
  // one test's write cannot be read as another's starting state.
  document.cookie = `${VISIBLE_COLUMNS_COOKIE}=; path=/; max-age=0`;
});

describe("TransactionList", () => {
  it("renders a row per transaction with its formatted date and amount", () => {
    render(<TransactionList {...props} />);

    // formatDate rewrites the ISO date as MM/DD/YYYY without a Date object,
    // so it cannot drift by a timezone.
    expect(screen.getByText("04/19/2026")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("-$82.31")).toBeInTheDocument();
  });

  it("renders only the columns it was handed", () => {
    render(
      <TransactionList {...props} visibleColumns={["date", "description"]} />
    );

    const header = screen.getAllByRole("row")[0];
    expect(within(header).getByText("Date")).toBeInTheDocument();
    expect(within(header).getByText("Description")).toBeInTheDocument();
    expect(within(header).queryByText("Amount")).not.toBeInTheDocument();
  });

  it("hides a column when its checkbox is cleared, and writes the cookie", async () => {
    const user = userEvent.setup();
    render(<TransactionList {...props} />);

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("checkbox", { name: "Amount" }));

    const header = screen.getAllByRole("row")[0];
    expect(within(header).queryByText("Amount")).not.toBeInTheDocument();

    const raw = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${VISIBLE_COLUMNS_COOKIE}=`))
      ?.split("=")[1];
    expect(parseVisibleColumnsCookie(raw)).not.toContain("amount");
    expect(parseVisibleColumnsCookie(raw)).toContain("date");
  });

  it("refuses to hide the last remaining column", async () => {
    const user = userEvent.setup();
    render(<TransactionList {...props} visibleColumns={["date"]} />);

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("checkbox", { name: "Date" }));

    // A table with no columns at all would render an unreadable shell, so the
    // toggle is a no-op at size 1 rather than a hide.
    const header = screen.getAllByRole("row")[0];
    expect(within(header).getByText("Date")).toBeInTheDocument();
  });

  it("restores a hidden column when its checkbox is ticked again", async () => {
    const user = userEvent.setup();
    render(<TransactionList {...props} visibleColumns={["date"]} />);

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("checkbox", { name: "Amount" }));

    const header = screen.getAllByRole("row")[0];
    expect(within(header).getByText("Amount")).toBeInTheDocument();
  });

  it("offers an edit and a delete control per row", () => {
    render(<TransactionList {...props} />);
    expect(
      screen.getByRole("button", { name: "Edit transaction" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete transaction" })
    ).toBeInTheDocument();
  });
});
