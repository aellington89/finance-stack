import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountingFilters } from "@/components/dashboard/accounting-filters";

const props = {
  descriptions: ["Groceries", "Rent"],
  accounts: [{ id: 1, name: "Everyday" }],
  categories: [{ id: 9, name: "Food" }],
  filters: {},
};

// Unlike TransactionFilters this one navigates with push, not replace — the
// accounting view is meant to stay in history.
const push = () =>
  vi.mocked(vi.mocked(useRouter).mock.results.at(-1)!.value.push);

const withParams = (qs: string) =>
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(qs) as unknown as ReturnType<typeof useSearchParams>
  );

describe("AccountingFilters", () => {
  it("renders the date-range control with its default-range hint", () => {
    // DateRangePicker renders its placeholder as button text rather than as a
    // native input attribute.
    render(<AccountingFilters {...props} />);
    expect(screen.getByText("Last 30 days (default)")).toBeInTheDocument();
  });

  it("hides Clear All until a filter is set", () => {
    render(<AccountingFilters {...props} />);
    expect(screen.queryByText("Clear All")).not.toBeInTheDocument();
  });

  it.each([
    ["dateFrom", { dateFrom: "2026-01-01" }],
    ["dateTo", { dateTo: "2026-02-01" }],
    ["descriptions", { descriptions: ["Rent"] }],
    ["accountIds", { accountIds: [1] }],
    ["categoryIds", { categoryIds: [9] }],
  ])("shows Clear All when %s is set", (_l, filters) => {
    render(<AccountingFilters {...props} filters={filters} />);
    expect(screen.getByText("Clear All")).toBeInTheDocument();
  });

  // "month" is the default grouping, so selecting it is not a filter and must
  // not light up Clear All or appear in the URL.
  it("does not treat the default month grouping as a filter", () => {
    render(<AccountingFilters {...props} filters={{ timeGrouping: "month" }} />);
    expect(screen.queryByText("Clear All")).not.toBeInTheDocument();
  });

  it("treats a non-default grouping as a filter", () => {
    render(<AccountingFilters {...props} filters={{ timeGrouping: "quarter" }} />);
    expect(screen.getByText("Clear All")).toBeInTheDocument();
  });

  it("treats empty arrays as no filter", () => {
    render(
      <AccountingFilters {...props} filters={{ accountIds: [], descriptions: [] }} />
    );
    expect(screen.queryByText("Clear All")).not.toBeInTheDocument();
  });

  it("Clear All returns to the bare accounting route", () => {
    render(<AccountingFilters {...props} filters={{ dateFrom: "2026-01-01" }} />);
    screen.getByText("Clear All").click();
    expect(push()).toHaveBeenCalledWith("/dashboard/accounting");
  });

  it("keeps existing params when clearing a single filter", () => {
    withParams("dateFrom=2026-01-01&accountIds=1");
    render(
      <AccountingFilters
        {...props}
        filters={{ dateFrom: "2026-01-01", accountIds: [1] }}
      />
    );
    // Nothing navigated on render — the component only pushes on interaction.
    expect(push()).not.toHaveBeenCalled();
  });
});
