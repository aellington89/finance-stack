import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountTypesCard } from "@/components/settings/account-types-card";
import type { AccountTypeRow } from "@/lib/queries/categories";

const action = () =>
  vi.fn(async () => ({ success: true, errors: {}, message: "" }));

const types: AccountTypeRow[] = [
  { accountTypeId: 1, accountType: "Checking", accountTypeCategoryId: 10, accountTypeCategory: "Current Asset" },
  { accountTypeId: 2, accountType: "Savings", accountTypeCategoryId: 10, accountTypeCategory: "Current Asset" },
  { accountTypeId: 3, accountType: "Credit Card", accountTypeCategoryId: 20, accountTypeCategory: "Current Liability" },
];

const props = {
  accountTypes: types,
  categoryOptions: [
    { id: 10, name: "Current Asset" },
    { id: 20, name: "Current Liability" },
  ],
  createAction: action(),
  updateAction: action(),
  deleteAction: action(),
};

describe("AccountTypesCard", () => {
  it("groups types under their category", () => {
    render(<AccountTypesCard {...props} />);
    expect(screen.getByText("Current Asset")).toBeInTheDocument();
    expect(screen.getByText("Current Liability")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Credit Card")).toBeInTheDocument();
  });

  it("sorts categories alphabetically regardless of input order", () => {
    render(
      <AccountTypesCard
        {...props}
        accountTypes={[types[2], types[0]]}
      />
    );
    const headers = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => t.includes("Current "));
    expect(headers[0]).toContain("Current Asset");
  });

  it("shows an empty message when there are no types", () => {
    render(<AccountTypesCard {...props} accountTypes={[]} />);
    expect(screen.getByText("No account types yet.")).toBeInTheDocument();
  });

  it("collapses a category group on click and restores it", async () => {
    const user = userEvent.setup();
    render(<AccountTypesCard {...props} />);

    expect(screen.getByText("Checking")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Current Asset/ }));
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
    // The sibling group is keyed separately and must be unaffected.
    expect(screen.getByText("Credit Card")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Current Asset/ }));
    expect(screen.getByText("Checking")).toBeInTheDocument();
  });

  it("offers edit and delete per type", () => {
    render(<AccountTypesCard {...props} />);
    expect(screen.getByRole("button", { name: "Edit Checking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Checking" })).toBeInTheDocument();
  });

  it("offers an add control per group and one for the card", () => {
    render(<AccountTypesCard {...props} />);
    expect(screen.getByRole("button", { name: "Add Account Type" })).toBeInTheDocument();
    // One "Add type" per category group.
    expect(screen.getAllByRole("button", { name: /Add type/ })).toHaveLength(2);
  });

  it("opens the edit dialog for the clicked type", async () => {
    const user = userEvent.setup();
    render(<AccountTypesCard {...props} />);
    await user.click(screen.getByRole("button", { name: "Edit Savings" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the delete dialog for the clicked type", async () => {
    const user = userEvent.setup();
    render(<AccountTypesCard {...props} />);
    await user.click(screen.getByRole("button", { name: "Delete Savings" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
