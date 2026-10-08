import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { TransactionList } from "@/components/transactions/transaction-list";
import { deleteTransaction } from "@/lib/actions/transaction";
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

// ── Row confirmations (Issue #148) ──

const rent = {
  ...transactions[0],
  transactionId: 2,
  transactionDescription: "Rent",
  transactionDate: "2026-04-01",
  amount: "-1500.00",
  transactionCategory: "Housing",
  transactionCategoryId: 10,
};

const twoRowProps = {
  ...props,
  transactions: [transactions[0], rent],
  totalCount: 2,
  categories: [
    { id: 9, name: "Food" },
    { id: 10, name: "Housing" },
  ],
};

// Finds a row by its description cell, so it only reaches rows that are not
// open for editing: an open row holds its description in an input instead.
function rowButton(description: string, name: string): HTMLElement {
  const row = screen.getByText(description).closest("tr");
  if (!row) throw new Error(`No table row shows "${description}"`);
  return within(row).getByRole("button", { name });
}

// Only one row is ever open, so there is only ever one of these.
function openDescription(): HTMLElement {
  return screen.getByRole("textbox", { name: "Description *" });
}

describe("TransactionList confirmations", () => {
  // jsdom stubs confirm() as not implemented and returns undefined, so a
  // regression to window.confirm() would not fail on its own: the row switch
  // would just quietly never happen. The spy turns it into a failed assertion.
  let confirmSpy: MockInstance<typeof window.confirm>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(deleteTransaction).mockClear();
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  // Opens Groceries for editing, changes its description, then clicks Edit on
  // Rent: the moment the discard guard exists for.
  async function promptToDiscard(user: UserEvent): Promise<HTMLElement> {
    render(<TransactionList {...twoRowProps} />);
    await user.click(rowButton("Groceries", "Edit transaction"));
    await user.clear(openDescription());
    await user.type(openDescription(), "Groceries and wine");
    await user.click(rowButton("Rent", "Edit transaction"));
    return screen.findByRole("dialog");
  }

  it("opens a row for editing straight away when no other row is open", async () => {
    const user = userEvent.setup();
    render(<TransactionList {...twoRowProps} />);

    await user.click(rowButton("Rent", "Edit transaction"));

    expect(openDescription()).toHaveValue("Rent");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("asks in a dialog before discarding an open edit", async () => {
    const user = userEvent.setup();
    const dialog = await promptToDiscard(user);

    expect(dialog).toHaveTextContent("Discard changes?");
    expect(confirmSpy).not.toHaveBeenCalled();
    // Nothing has switched yet: Groceries is still the open row.
    expect(screen.getByDisplayValue("Groceries and wine")).toBeInTheDocument();
  });

  // Every way out of the dialog short of Discard is the same answer, as it is
  // for the delete dialogs.
  const dismissals: [string, (user: UserEvent, dialog: HTMLElement) => Promise<void>][] = [
    [
      "Keep editing",
      (user, dialog) =>
        user.click(within(dialog).getByRole("button", { name: "Keep editing" })),
    ],
    [
      "the corner close button",
      (user, dialog) =>
        user.click(within(dialog).getByRole("button", { name: "Close" })),
    ],
    ["Escape", (user) => user.keyboard("{Escape}")],
  ];

  it.each(dismissals)(
    "keeps the open edit, typed changes and all, on %s",
    async (_way, dismiss) => {
      const user = userEvent.setup();
      const dialog = await promptToDiscard(user);

      await dismiss(user, dialog);
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      );

      // The same edit row rather than a remount of it: the typed text survived.
      expect(openDescription()).toHaveValue("Groceries and wine");
      expect(rowButton("Rent", "Edit transaction")).toBeInTheDocument();
    }
  );

  it("switches rows once the user discards", async () => {
    const user = userEvent.setup();
    const dialog = await promptToDiscard(user);

    await user.click(
      within(dialog).getByRole("button", { name: "Discard changes" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );

    expect(openDescription()).toHaveValue("Rent");
    // Groceries is back to its saved values; the typed text went with the row.
    expect(rowButton("Groceries", "Edit transaction")).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Groceries and wine")
    ).not.toBeInTheDocument();
  });

  it("confirms a delete in the delete dialog, not window.confirm()", async () => {
    const user = userEvent.setup();
    render(<TransactionList {...twoRowProps} />);

    await user.click(rowButton("Rent", "Delete transaction"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete Transaction");
    expect(dialog).toHaveTextContent("Rent");
    expect(confirmSpy).not.toHaveBeenCalled();
    // Opening the dialog is not the delete; that waits for its own button.
    expect(deleteTransaction).not.toHaveBeenCalled();
  });
});
