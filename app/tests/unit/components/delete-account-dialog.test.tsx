import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountDialog } from "@/components/accounts/delete-account-dialog";
import { deleteAccount } from "@/lib/actions/account";

// The action reaches lib/auth/guard -> @/auth -> next-auth, which does not
// resolve under jsdom. Cutting the chain at the action module.
vi.mock("@/lib/actions/account", () => ({
  deleteAccount: vi.fn(async () => ({ success: true, errors: {}, message: "" })),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

// The action mock is module-level, so without this a call made by one test is
// still on the books when the next one counts.
beforeEach(() => {
  vi.mocked(deleteAccount).mockClear();
});

describe("DeleteAccountDialog", () => {
  it("renders a trigger without opening the dialog", () => {
    render(<DeleteAccountDialog accountId={7} accountName="Everyday" />);
    expect(screen.getByRole("button", { name: "Delete Account" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the account in the confirmation, so the wrong one is visible", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountDialog accountId={7} accountName="Everyday" />);

    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Everyday");
    expect(dialog).toHaveTextContent("cannot be undone");
  });

  it("submits the account id the dialog was given", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountDialog accountId={7} accountName="Everyday" />);

    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete Account" })
    );

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    const formData = vi.mocked(deleteAccount).mock.calls[0][1] as FormData;
    expect(formData.get("accountId")).toBe("7");
  });

  // Issue #148: every delete dialog offers the same Cancel, not only the ×.
  it("closes on Cancel without deleting the account", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountDialog accountId={7} accountName="Everyday" />);

    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
