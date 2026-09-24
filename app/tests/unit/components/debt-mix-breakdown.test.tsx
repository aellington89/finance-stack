import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DebtMixBreakdown } from "@/components/dashboard/debt-mix-breakdown";
import type { LiabilityAllocationData } from "@/lib/queries/liabilities-drilldown";

/** One category holding `count` account types, each -1000 and an even share. */
const withTypes = (count: number): LiabilityAllocationData => ({
  totalLiabilities: -1000 * count,
  currentLiabilities: 0,
  nonCurrentLiabilities: 0,
  asOf: "2026-05-02",
  byCategory: [
    {
      categoryId: 5,
      categoryName: "Current Liability",
      value: -1000 * count,
      percentOfTotal: 100,
      children: Array.from({ length: count }, (_, i) => ({
        accountTypeId: 10 + i,
        accountTypeName: `Type ${i + 1}`,
        value: -1000,
        percentOfParent: 100 / count,
        percentOfTotal: 100 / count,
      })),
    },
  ],
});

describe("DebtMixBreakdown", () => {
  it("renders a tile per account type with its name, amount and share", () => {
    render(<DebtMixBreakdown data={withTypes(2)} />);

    expect(screen.getByText("Debt Mix")).toBeInTheDocument();
    expect(screen.getByText("Type 1")).toBeInTheDocument();
    expect(screen.getByText("Type 2")).toBeInTheDocument();
    expect(screen.getAllByText("-$1,000.00")).toHaveLength(2);
    expect(screen.getAllByText("50.0%")).toHaveLength(2);
  });

  it("renders the empty state instead of a grid when nothing is outstanding", () => {
    render(
      <DebtMixBreakdown
        data={{
          totalLiabilities: 0,
          currentLiabilities: 0,
          nonCurrentLiabilities: 0,
          asOf: "2026-05-02",
          byCategory: [
            {
              categoryId: 5,
              categoryName: "Current Liability",
              value: 0,
              percentOfTotal: 0,
              // A zero-balance type is filtered out by the transform, which is
              // what leaves the tile list empty.
              children: [
                {
                  accountTypeId: 15,
                  accountTypeName: "Credit Card",
                  value: 0,
                  percentOfParent: 0,
                  percentOfTotal: 0,
                },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("No outstanding liabilities.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the total liabilities figure", () => {
    render(<DebtMixBreakdown data={withTypes(3)} />);
    expect(screen.getByText("-$3,000.00")).toBeInTheDocument();
  });

  // The grid class is a static-string switch because Tailwind cannot purge a
  // dynamic class name — so each arm is a real branch worth pinning.
  it.each([
    [1, "grid-cols-1"],
    [2, "grid-cols-2"],
    [3, "grid-cols-2 md:grid-cols-3"],
    [4, "grid-cols-2 md:grid-cols-4"],
    [6, "grid-cols-2 md:grid-cols-5"],
  ])("lays %i tiles out as %s", (count, expected) => {
    const { container } = render(<DebtMixBreakdown data={withTypes(count)} />);
    const grid = container.querySelector('[class*="grid gap-3"]');
    expect(grid?.className).toContain(expected);
  });

  it("labels the distribution bar and draws one segment per tile", () => {
    const { container } = render(<DebtMixBreakdown data={withTypes(2)} />);
    expect(
      screen.getByRole("img", { name: "Debt mix distribution" })
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-testid^="debt-mix-bar-"]')
    ).toHaveLength(2);
  });
});
