import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter, useSearchParams } from "next/navigation";
import { TransactionFilters } from "@/components/transactions/transaction-filters";

const props = {
  descriptions: ["Groceries", "Rent"],
  accounts: [{ id: 1, name: "Everyday" }],
  types: [{ id: 3, name: "Expense" }],
  categories: [{ id: 9, name: "Food" }],
  filters: {},
};

// The router the component itself received, read back out of the mock rather
// than by calling useRouter() here — a hook call in a plain function is a
// rules-of-hooks error, and this also asserts against exactly the object the
// component used. vitest-setup.ts clears it before each test.
const replace = () =>
  vi.mocked(vi.mocked(useRouter).mock.results.at(-1)!.value.replace);

const withParams = (qs: string) =>
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(qs) as unknown as ReturnType<typeof useSearchParams>
  );

describe("TransactionFilters", () => {
  it("renders a slot per filterable field", () => {
    render(<TransactionFilters {...props} />);
    expect(screen.getByPlaceholderText("Amount, e.g. 50.00")).toBeInTheDocument();
  });

  it("hides Clear All until at least one filter is set", () => {
    render(<TransactionFilters {...props} />);
    expect(screen.queryByText("Clear All")).not.toBeInTheDocument();
  });

  it.each([
    ["dateFrom", { dateFrom: "2026-01-01" }],
    ["amount", { amount: "50.00" }],
    ["accountIds", { accountIds: [1] }],
    ["typeIds", { typeIds: [3] }],
    ["categoryIds", { categoryIds: [9] }],
    ["descriptions", { descriptions: ["Rent"] }],
  ])("shows Clear All when %s is set", (_label, filters) => {
    render(<TransactionFilters {...props} filters={filters} />);
    expect(screen.getByText("Clear All")).toBeInTheDocument();
  });

  it("treats an empty array as no filter rather than as a set one", () => {
    render(<TransactionFilters {...props} filters={{ accountIds: [], typeIds: [] }} />);
    expect(screen.queryByText("Clear All")).not.toBeInTheDocument();
  });

  it("Clear All returns to the bare route, dropping every param", () => {
    render(<TransactionFilters {...props} filters={{ amount: "50.00" }} />);
    screen.getByText("Clear All").click();
    expect(replace()).toHaveBeenCalledWith("/dashboard/transactions");
  });

  it("pushes an amount filter into the query string on blur", async () => {
    const user = userEvent.setup();
    render(<TransactionFilters {...props} />);

    const amount = screen.getByPlaceholderText("Amount, e.g. 50.00");
    await user.type(amount, "50.00");
    await user.tab();

    expect(replace()).toHaveBeenCalledWith("/dashboard/transactions?amount=50.00");
  });

  it("clears the param when the amount is emptied", async () => {
    const user = userEvent.setup();
    withParams("amount=50.00");
    render(<TransactionFilters {...props} filters={{ amount: "50.00" }} />);

    const amount = screen.getByPlaceholderText("Amount, e.g. 50.00");
    await user.clear(amount);
    await user.tab();

    expect(replace()).toHaveBeenCalledWith("/dashboard/transactions");
  });

  it("resets pagination whenever a filter changes", async () => {
    // Page 3 of an old filter must not survive into a new one, or the user
    // lands on an empty page.
    const user = userEvent.setup();
    withParams("page=3");
    render(<TransactionFilters {...props} />);

    await user.type(screen.getByPlaceholderText("Amount, e.g. 50.00"), "12");
    await user.tab();

    expect(replace()).toHaveBeenCalledWith("/dashboard/transactions?amount=12");
  });

  it("preserves unrelated params it did not set", async () => {
    const user = userEvent.setup();
    withParams("sortBy=amount");
    render(<TransactionFilters {...props} />);

    await user.type(screen.getByPlaceholderText("Amount, e.g. 50.00"), "12");
    await user.tab();

    const url = replace().mock.calls.at(-1)![0] as string;
    expect(url).toContain("sortBy=amount");
    expect(url).toContain("amount=12");
  });
});
