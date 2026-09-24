import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountForm } from "@/components/accounts/account-form";
import { createAccount, updateAccount } from "@/lib/actions/account";

// Both actions reach next-auth through lib/auth/guard, which does not resolve
// under jsdom; the form's own contract is which action it picks and what it
// submits.
vi.mock("@/lib/actions/account", () => ({
  createAccount: vi.fn(async () => ({ success: false, errors: {}, message: "" })),
  updateAccount: vi.fn(async () => ({ success: false, errors: {}, message: "" })),
  deleteAccount: vi.fn(),
}));

const accountTypes = [
  { id: 1, name: "Checking", liquidityClass: "liquid" },
  { id: 2, name: "Property", liquidityClass: "illiquid" },
];

const existing = {
  accountId: 7,
  accountName: "Everyday",
  accountTypeId: 1,
  accountIdentifier: "1234",
  openedDate: "2026-01-01",
  closedDate: null,
  liquidityClass: null,
};

describe("AccountForm", () => {
  it("renders the create affordance when given no account", () => {
    render(<AccountForm accountTypes={accountTypes} />);
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Account Name/)).toHaveValue("");
  });

  it("renders the edit affordance and pre-fills when given an account", () => {
    render(<AccountForm accountTypes={accountTypes} account={existing} />);
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Account Name/)).toHaveValue("Everyday");
    expect(screen.getByLabelText(/Account Identifier/)).toHaveValue("1234");
  });

  it("carries the account id only in edit mode", () => {
    const { container: create } = render(<AccountForm accountTypes={accountTypes} />);
    expect(create.querySelector('input[name="accountId"]')).toBeNull();

    const { container: edit } = render(
      <AccountForm accountTypes={accountTypes} account={existing} />
    );
    expect(edit.querySelector('input[name="accountId"]')).toHaveValue("7");
  });

  it("submits to createAccount, not updateAccount, in create mode", async () => {
    const user = userEvent.setup();
    render(<AccountForm accountTypes={accountTypes} defaultTypeId={1} />);

    await user.type(screen.getByLabelText(/Account Name/), "Savings");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(updateAccount).not.toHaveBeenCalled();
    const fd = vi.mocked(createAccount).mock.calls[0][1] as FormData;
    expect(fd.get("accountName")).toBe("Savings");
    expect(fd.get("accountTypeId")).toBe("1");
  });

  it("submits to updateAccount in edit mode", async () => {
    const user = userEvent.setup();
    render(<AccountForm accountTypes={accountTypes} account={existing} />);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateAccount).toHaveBeenCalledTimes(1);
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("preselects the default type it was handed", () => {
    const { container } = render(
      <AccountForm accountTypes={accountTypes} defaultTypeId={2} />
    );
    expect(container.querySelector('input[name="accountTypeId"]')).toHaveValue("2");
  });

  it("leaves the type unset when given neither an account nor a default", () => {
    const { container } = render(<AccountForm accountTypes={accountTypes} />);
    expect(container.querySelector('input[name="accountTypeId"]')).toHaveValue("");
  });
});
