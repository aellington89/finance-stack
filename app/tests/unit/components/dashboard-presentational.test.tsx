import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { DateRangeError } from "@/components/dashboard/date-range-error";
import { AccountingKpiCard } from "@/components/dashboard/accounting-kpi-card";

describe("DashboardPageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<DashboardPageHeader title="Accounts" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Accounts");
  });

  it("renders subnav and filters when given", () => {
    render(
      <DashboardPageHeader
        title="Accounts"
        subnav={<nav>tabs</nav>}
        filters={<div>filters</div>}
      />
    );
    expect(screen.getByText("tabs")).toBeInTheDocument();
    expect(screen.getByText("filters")).toBeInTheDocument();
  });

  it("omits the filter row entirely when no filters are given", () => {
    const { container } = render(<DashboardPageHeader title="Accounts" />);
    expect(container.querySelector(".mt-3")).toBeNull();
  });
});

describe("ComingSoon", () => {
  it("names the feature that is not built yet", () => {
    render(<ComingSoon feature="Merchants" />);
    expect(screen.getByText("Merchants")).toBeInTheDocument();
    expect(screen.getByText("This drilldown is coming soon.")).toBeInTheDocument();
  });
});

describe("DateRangeError", () => {
  it("announces itself as an alert with the default title", () => {
    render(<DateRangeError message="dateFrom is after dateTo" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Invalid date range");
    expect(alert).toHaveTextContent("dateFrom is after dateTo");
  });

  it("accepts a custom title for the filter-param case", () => {
    render(<DateRangeError title="Invalid filter" message="bad accountId" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid filter");
  });
});

describe("AccountingKpiCard", () => {
  it("renders the headline value", () => {
    render(<AccountingKpiCard title="Income" value="$4,200.00" />);
    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.getByText("$4,200.00")).toBeInTheDocument();
  });

  it("omits the detail row when there is neither subtitle nor change", () => {
    render(<AccountingKpiCard title="Income" value="$0.00" />);
    expect(screen.queryByText(/vs\./)).not.toBeInTheDocument();
  });

  // "Good" depends on the metric: a fall in expenses is green, a fall in
  // income is red. positiveDirection is what encodes that.
  it("colours a fall green when down is the good direction", () => {
    const { container } = render(
      <AccountingKpiCard
        title="Expenses"
        value="$1,000.00"
        positiveDirection="down"
        change={{ percent: -12.5, direction: "down", label: "vs. Feb" }}
      />
    );
    expect(container.innerHTML).toContain("text-green-500");
    expect(screen.getByText(/12\.50%/)).toBeInTheDocument();
  });

  it("colours the same fall red when up is the good direction", () => {
    const { container } = render(
      <AccountingKpiCard
        title="Income"
        value="$1,000.00"
        positiveDirection="up"
        change={{ percent: -12.5, direction: "down", label: "vs. Feb" }}
      />
    );
    expect(container.innerHTML).toContain("text-red-500");
  });

  it("says 'No change' rather than showing an arrow and 0.00%", () => {
    render(
      <AccountingKpiCard
        title="Income"
        value="$1,000.00"
        change={{ percent: 0, direction: "none", label: "vs. Feb" }}
      />
    );
    expect(screen.getByText("No change")).toBeInTheDocument();
    expect(screen.queryByText(/0\.00%/)).not.toBeInTheDocument();
  });

  it("renders the comparison label alongside any change", () => {
    render(
      <AccountingKpiCard
        title="Income"
        value="$1,000.00"
        change={{ percent: 5, direction: "up", label: "vs. Feb: $950.00" }}
      />
    );
    expect(screen.getByText("vs. Feb: $950.00")).toBeInTheDocument();
  });

  it("renders a subtitle without a change", () => {
    render(
      <AccountingKpiCard title="Income" value="$1,000.00" subtitle="30 days" />
    );
    expect(screen.getByText("30 days")).toBeInTheDocument();
  });
});
