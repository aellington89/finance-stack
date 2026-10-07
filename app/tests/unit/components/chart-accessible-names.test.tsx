import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeSeriesChart } from "@/components/charts/net-worth-chart";
import { NetWorthTimeSeriesChart } from "@/components/charts/net-worth-timeseries-chart";
import { WaterfallChart } from "@/components/charts/waterfall-chart";
import { DebtWaterfallChart } from "@/components/charts/debt-waterfall-chart";
import { AssetsTimeSeriesChart } from "@/components/charts/assets-timeseries-chart";
import { LiabilitiesTimeSeriesChart } from "@/components/charts/liabilities-timeseries-chart";
import { AccountingChart } from "@/components/charts/accounting-chart";
import { WorkExpensesChart } from "@/components/charts/work-expenses-chart";
import { ExpensesCategoryChart } from "@/components/charts/expenses-category-chart";
import { AssetAllocationChart } from "@/components/charts/asset-allocation-chart";
import { LiabilityAllocationChart } from "@/components/charts/liability-allocation-chart";
import type { TimeSeriesPoint } from "@/lib/queries/dashboard";
import type {
  DecompositionPoint,
  WaterfallData,
} from "@/lib/queries/net-worth-drilldown";
import type {
  AllocationData,
  AssetDecompositionPoint,
} from "@/lib/queries/assets-drilldown";
import type {
  DebtWaterfallData,
  LiabilityAllocationData,
  LiabilityDecompositionPoint,
} from "@/lib/queries/liabilities-drilldown";
import type {
  AccountingTimeSeriesPoint,
  CategoryBreakdown,
} from "@/lib/queries/accounting";
import type { WorkExpenseTimeSeriesPoint } from "@/lib/queries/work-expenses";

// Issue #144. The one place the recharts wrappers are rendered, because the
// contract under test exists only in a drawn chart: the accessible name is the
// text recharts writes into its <svg>'s <title>, and a prop is no guarantee of
// that. Treemap is the case in point. Its types reject `title` and `desc`, and
// forced past the compiler they still never reach the SVG, which is why the
// two allocation charts name a wrapper instead.
//
// jsdom has no layout, so the real ResponsiveContainer measures 0×0 and
// recharts draws nothing (docs/testing.md). A fixed size is all a name needs.
// The files stay out of the coverage denominator all the same: drawing a
// chart runs its axis formatters, but this asserts only on the name, so
// counting those statements would be coverage with no assertion behind it.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      cloneElement(children as ReactElement<{ width?: number; height?: number }>, {
        width: 800,
        height: 400,
      }),
  };
});

const points: TimeSeriesPoint[] = [
  { date: "2026-09-01", totalAssets: 10_000, totalLiabilities: -2_000, netWorth: 8_000 },
  { date: "2026-09-02", totalAssets: 10_500, totalLiabilities: -2_000, netWorth: 8_500 },
];

const account = {
  categoryId: 1,
  categoryName: "Current Asset",
  accountTypeId: 2,
  accountTypeName: "Checking",
  accountId: 7,
  accountName: "Everyday",
};
const decomposition: DecompositionPoint[] = [
  { ...account, date: "2026-09-01", cumulativeBalance: 8_000 },
  { ...account, date: "2026-09-02", cumulativeBalance: 8_500 },
];
const assetDecomposition: AssetDecompositionPoint[] = decomposition.map((p) => ({
  ...p,
  liquidityClass: "liquid",
}));
const liabilityDecomposition: LiabilityDecompositionPoint[] = [
  { ...account, categoryId: 5, categoryName: "Current Liability", date: "2026-09-01", cumulativeBalance: -2_000 },
  { ...account, categoryId: 5, categoryName: "Current Liability", date: "2026-09-02", cumulativeBalance: -1_900 },
];

const waterfall: WaterfallData = {
  startNetWorth: 8_000,
  endNetWorth: 8_500,
  categories: [
    { categoryId: 1, categoryName: "Current Asset", startBalance: 8_000, endBalance: 8_500, change: 500 },
  ],
};
const debtWaterfall: DebtWaterfallData = {
  startBalance: -2_000,
  endBalance: -1_900,
  payments: 150,
  interestAccrued: -50,
  other: 0,
};

const accounting: AccountingTimeSeriesPoint[] = [
  { date: "2026-09-01", totalIncome: 5_000, totalExpenses: 3_000, totalInvestments: 500 },
  { date: "2026-10-01", totalIncome: 5_200, totalExpenses: 2_800, totalInvestments: 600 },
];
const workExpenses: WorkExpenseTimeSeriesPoint[] = [
  { date: "2026-09-01", totalExpenses: 200, totalReimbursements: 150 },
];
const categories: CategoryBreakdown[] = [
  { category: "Housing", total: 1_500 },
  { category: "Food", total: 600 },
];

const assetAllocation: AllocationData = {
  totalAssets: 10_000,
  asOf: "2026-09-02",
  byCategory: [
    {
      categoryId: 1,
      categoryName: "Current Asset",
      value: 10_000,
      percentOfTotal: 100,
      children: [
        { accountTypeId: 2, accountTypeName: "Checking", value: 10_000, percentOfParent: 100, percentOfTotal: 100 },
      ],
    },
  ],
};
const liabilityAllocation: LiabilityAllocationData = {
  totalLiabilities: -2_000,
  currentLiabilities: -2_000,
  nonCurrentLiabilities: 0,
  asOf: "2026-09-02",
  byCategory: [
    {
      categoryId: 5,
      categoryName: "Current Liability",
      value: -2_000,
      percentOfTotal: 100,
      children: [
        { accountTypeId: 15, accountTypeName: "Credit Card", value: -2_000, percentOfParent: 100, percentOfTotal: 100 },
      ],
    },
  ],
};

// The SVG's own <desc>: recharts renders <title> and <desc> as its first two
// children, so the first <desc> under the chart is the one.
const descOf = (svg: Element) => svg.querySelector("desc")?.textContent;

// The card title the chart sits under. The SVG's <title> carries the same
// text, so an unscoped getByText would find both.
const cardTitle = (name: string) =>
  screen.getByText(name, { selector: "[data-slot='card-title']" });

describe("chart accessible names", () => {
  // recharts' accessibility layer makes each of these a focusable
  // role="application"; before #144 every one of them was an unnamed tab stop.
  it.each([
    {
      name: "Net Worth Over Time",
      chart: <NetWorthTimeSeriesChart timeSeries={points} decomposition={decomposition} />,
      desc: "Line chart of net worth across the selected date range.",
    },
    {
      name: "Net Worth Waterfall",
      chart: <WaterfallChart data={waterfall} />,
      desc: "Bar chart bridging net worth from the start to the end of the selected range, with one bar for each account category that changed.",
    },
    {
      name: "Debt Waterfall",
      chart: <DebtWaterfallChart data={debtWaterfall} />,
      desc: "Bar chart bridging total liabilities from the start to the end of the selected range through payments, interest and other changes.",
    },
    {
      name: "Assets Over Time (by category)",
      chart: <AssetsTimeSeriesChart decomposition={assetDecomposition} />,
      desc: "Stacked area chart of asset balances across the selected date range, one band per account category.",
    },
    {
      name: "Liabilities Over Time (by category)",
      chart: <LiabilitiesTimeSeriesChart decomposition={liabilityDecomposition} />,
      desc: "Stacked area chart of liability balances across the selected date range, one band per account category.",
    },
    {
      name: "Totals Over Time",
      chart: <AccountingChart data={accounting} />,
      desc: "Area chart of total income, expenses and investments, one point per month.",
    },
    {
      name: "Expenses vs Reimbursements Over Time",
      chart: <WorkExpensesChart data={workExpenses} />,
      desc: "Bar chart of work expenses and reimbursements, one pair of bars per month.",
    },
    {
      name: "Total Expenses by Category",
      chart: <ExpensesCategoryChart data={categories} />,
      desc: "Donut chart of totals by category, showing the ten largest and grouping any others as Other.",
    },
  ])("names $name after its card title and says what it plots", ({ name, chart, desc }) => {
    render(chart);

    const svg = screen.getByRole("application", { name });
    expect(descOf(svg)).toBe(desc);
    expect(cardTitle(name)).toBeInTheDocument();
  });

  it("names the category donut after whatever title the page gives it", () => {
    render(<ExpensesCategoryChart data={categories} title="Work Expenses by Category" />);

    expect(
      screen.getByRole("application", { name: "Work Expenses by Category" })
    ).toBeInTheDocument();
  });

  it("describes the accounting chart in the grouping the filter chose", () => {
    render(<AccountingChart data={accounting} timeGrouping="day_of_week" />);

    const svg = screen.getByRole("application", { name: "Totals Over Time" });
    expect(descOf(svg)).toBe(
      "Area chart of total income, expenses and investments, one point per day of week."
    );
  });

  it("re-describes the net worth chart when its mode splits the line", async () => {
    const user = userEvent.setup();
    render(<NetWorthTimeSeriesChart timeSeries={points} decomposition={decomposition} />);

    await user.click(screen.getByRole("button", { name: "By Account Type" }));

    const svg = screen.getByRole("application", { name: "Net Worth Over Time" });
    expect(descOf(svg)).toBe(
      "Line chart of net worth split into one line per account type, across the selected date range."
    );
  });

  it("names the Summary trend chart without making it a tab stop inside its link", () => {
    render(
      <TimeSeriesChart
        title="Net Worth"
        data={points}
        dataKey="netWorth"
        color="#2eb88a"
        href="/dashboard/net-worth"
      />
    );

    // The link is named for the card alone. Left to its content it would also
    // take the chart's <title> and read "Net Worth Net Worth".
    const link = screen.getByRole("link", { name: "Net Worth" });
    const svg = link.querySelector("svg.recharts-surface")!;
    expect(svg).toHaveAccessibleName("Net Worth");
    expect(descOf(svg)).toBe("Line chart of net worth across the selected date range.");

    // The link is the one tab stop. (recharts' tooltip wrapper carries
    // tabindex="-1", which is focusable by script but not by Tab.)
    expect(svg).not.toHaveAttribute("role", "application");
    expect(link.querySelectorAll("[tabindex]:not([tabindex='-1'])")).toHaveLength(0);
  });

  it("keeps the trend chart a named tab stop when it is not a link", () => {
    render(<TimeSeriesChart title="Net Worth" data={points} dataKey="netWorth" color="#2eb88a" />);

    expect(screen.getByRole("application", { name: "Net Worth" })).toHaveAttribute(
      "tabindex",
      "0"
    );
  });

  // Treemap drops `title`/`desc`, so the name sits on a role="img" wrapper.
  it.each([
    {
      name: "Asset Allocation",
      chart: <AssetAllocationChart data={assetAllocation} />,
      desc: "Treemap of asset balances by account type, each tile sized by its balance and grouped by account category.",
    },
    {
      name: "Liability Allocation",
      chart: <LiabilityAllocationChart data={liabilityAllocation} />,
      desc: "Treemap of liability balances by account type, each tile sized by its balance and grouped by account category.",
    },
  ])("names the $name treemap through an image wrapper", ({ name, chart, desc }) => {
    render(chart);

    const image = screen.getByRole("img", { name });
    expect(image).toHaveAccessibleDescription(desc);
    expect(image.querySelector("svg.recharts-surface")).toBeInTheDocument();
    expect(cardTitle(name)).toBeInTheDocument();
  });

  it("leaves an empty treemap's message readable rather than inside an image", () => {
    render(
      <AssetAllocationChart data={{ ...assetAllocation, totalAssets: 0, byCategory: [] }} />
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No asset balances in the selected range.")).toBeInTheDocument();
  });
});
