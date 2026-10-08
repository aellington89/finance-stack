import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionDeleteDialog } from "@/components/transactions/transaction-delete-dialog";
import { deleteTransaction } from "@/lib/actions/transaction";

// The action reaches lib/auth/guard -> @/auth -> next-auth, which does not
// resolve under jsdom. Cutting the chain at the action module.
vi.mock("@/lib/actions/transaction", () => ({
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

beforeEach(() => {
  vi.mocked(deleteTransaction).mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <TransactionDeleteDialog
      open
      onOpenChange={onOpenChange}
      transactionId={42}
      date="2026-04-19"
      description="Groceries"
      amount="-82.31"
    />
  );
  return onOpenChange;
}

describe("TransactionDeleteDialog", () => {
  it("shows the transaction it would delete, so the wrong one is visible", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("04/19/2026");
    expect(dialog).toHaveTextContent("Groceries");
    expect(dialog).toHaveTextContent("-$82.31");
    expect(dialog).toHaveTextContent("cannot be undone");
  });

  it("closes on Cancel without deleting anything", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
    expect(deleteTransaction).not.toHaveBeenCalled();
  });

  it("submits the transaction id it was given", async () => {
    vi.mocked(deleteTransaction).mockResolvedValue({
      success: true,
      errors: {},
      message: "Transaction deleted successfully",
    });
    const user = userEvent.setup();
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete Transaction" })
    );

    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(deleteTransaction).mock.calls[0][1];
    expect(formData.get("transactionId")).toBe("42");
  });

  it("confirms a delete with a success toast and closes", async () => {
    vi.mocked(deleteTransaction).mockResolvedValue({
      success: true,
      errors: {},
      message: "Transaction deleted successfully",
    });
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete Transaction" })
    );

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Transaction deleted successfully"
      )
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open on a failed delete and says why", async () => {
    vi.mocked(deleteTransaction).mockResolvedValue({
      success: false,
      errors: {},
      message: "Transaction not found",
    });
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete Transaction" })
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Transaction not found")
    );
    // Left open so the user can retry or cancel, not closed on a failure.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
