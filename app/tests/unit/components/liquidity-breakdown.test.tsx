import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiquidityBreakdown } from "@/components/dashboard/liquidity-breakdown";
import type { LiquidityData } from "@/lib/queries/assets-drilldown";

const fourClasses: LiquidityData = {
  total: 100_000,
  asOf: "2026-04-19",
  classes: [
    { liquidityClass: "liquid", value: 25_000, percent: 25 },
    { liquidityClass: "semi_liquid", value: 25_000, percent: 25 },
    { liquidityClass: "illiquid", value: 40_000, percent: 40 },
    { liquidityClass: "restricted", value: 10_000, percent: 10 },
  ],
};

describe("LiquidityBreakdown", () => {
  it("renders one tile per class with its label, amount and share", () => {
    render(<LiquidityBreakdown data={fourClasses} />);

    expect(screen.getByText("Liquidity Breakdown")).toBeInTheDocument();
    for (const label of ["Liquid", "Semi-liquid", "Illiquid", "Restricted"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("$40,000.00")).toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
  });

  it("renders the period total", () => {
    render(<LiquidityBreakdown data={fourClasses} />);
    expect(screen.getByText("$100,000.00")).toBeInTheDocument();
  });

  it("omits the unclassified tile when the data has no such bucket", () => {
    render(<LiquidityBreakdown data={fourClasses} />);
    expect(screen.queryByText("Unclassified")).not.toBeInTheDocument();
  });

  it("renders the unclassified tile when the data carries one", () => {
    render(
      <LiquidityBreakdown
        data={{
          total: 1_100,
          asOf: "2026-04-19",
          classes: [
            { liquidityClass: "liquid", value: 1_000, percent: 90.91 },
            { liquidityClass: "unclassified", value: 100, percent: 9.09 },
          ],
        }}
      />
    );
    expect(screen.getByText("Unclassified")).toBeInTheDocument();
  });

  it("renders an absent class at zero rather than dropping it", () => {
    render(
      <LiquidityBreakdown
        data={{
          total: 1_000,
          asOf: "2026-04-19",
          classes: [{ liquidityClass: "liquid", value: 1_000, percent: 100 }],
        }}
      />
    );

    // Three of the four always-on tiles have no bucket in this data.
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00")).toHaveLength(3);
  });

  it("gives the distribution bar an accessible name and omits zero-width segments", () => {
    const { container } = render(
      <LiquidityBreakdown
        data={{
          total: 1_000,
          asOf: "2026-04-19",
          classes: [{ liquidityClass: "liquid", value: 1_000, percent: 100 }],
        }}
      />
    );

    expect(
      screen.getByRole("img", { name: "Liquidity distribution" })
    ).toBeInTheDocument();
    // Only the one class with a positive percent draws a segment.
    expect(
      container.querySelectorAll('[data-testid^="liquidity-bar-"]')
    ).toHaveLength(1);
  });
});
