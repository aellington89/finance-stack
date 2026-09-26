import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { submitTransaction } from "@/lib/actions/transaction";

vi.mock("@/lib/actions/transaction", () => ({
  submitTransaction: vi.fn(async () => ({
    success: false,
    errors: {},
    message: "",
  })),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
  },
}));

const props = {
  accounts: [
    { id: 1, name: "Everyday" },
    { id: 2, name: "Savings" },
  ],
  types: [{ id: 3, name: "Expense" }],
  categories: [{ id: 9, name: "Food" }],
};

describe("TransactionForm", () => {
  it("renders the required description and amount fields", () => {
    render(<TransactionForm {...props} />);
    expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("defaults the transaction date to today rather than leaving it blank", () => {
    const { container } = render(<TransactionForm {...props} />);
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(container.querySelector('input[name="transactionDate"]')).toHaveValue(
      expected
    );
  });

  it("submits the entered description to the action", async () => {
    const user = userEvent.setup();
    render(<TransactionForm {...props} />);

    await user.type(screen.getByLabelText(/Description/), "Groceries");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(submitTransaction).toHaveBeenCalledTimes(1);
    const fd = vi.mocked(submitTransaction).mock.calls[0][1] as FormData;
    expect(fd.get("transactionDescription")).toBe("Groceries");
  });

  it("carries a hidden field for every custom control the action needs", () => {
    const { container } = render(<TransactionForm {...props} />);
    for (const name of [
      "transactionDate",
      "amount",
      "accountId",
      "relatedAccountId",
      "transactionTypeId",
      "transactionCategoryId",
    ]) {
      expect(container.querySelector(`input[name="${name}"]`)).toBeInTheDocument();
    }
  });

  // jsdom has no layout engine and evaluates neither media nor container
  // queries, so this can only pin the classes; the stacking itself was checked
  // in a browser (Issue #145). toHaveClass rather than className.toContain:
  // "@md:grid-cols-2" contains "grid-cols-2", so a substring check could not
  // tell the fix from the bug.
  it("stacks its two-up rows until the form itself is wide enough for two", () => {
    const { container } = render(<TransactionForm {...props} />);
    expect(container.querySelector("form")).toHaveClass("@container");

    for (const field of ["#amount", "#transactionTypeId"]) {
      const row = container.querySelector(field)?.closest(".grid");
      expect(row).toHaveClass("grid-cols-1", "@md:grid-cols-2");
      expect(row).not.toHaveClass("grid-cols-2");
    }
  });

  it("shows no error region before a submission", () => {
    render(<TransactionForm {...props} />);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("surfaces a failed submission as an error toast", async () => {
    vi.mocked(submitTransaction).mockResolvedValueOnce({
      success: false,
      errors: {},
      message: "Amount is required",
    });
    const user = userEvent.setup();
    render(<TransactionForm {...props} />);

    await user.type(screen.getByLabelText(/Description/), "Groceries");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Amount is required")
    );
  });

  it("confirms a successful submission with a success toast", async () => {
    vi.mocked(submitTransaction).mockResolvedValueOnce({
      success: true,
      errors: {},
      message: "Transaction added",
    });
    const user = userEvent.setup();
    render(<TransactionForm {...props} />);

    await user.type(screen.getByLabelText(/Description/), "Groceries");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await vi.waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Transaction added")
    );
  });
});
