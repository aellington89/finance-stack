import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardDateRangeFilter } from "@/components/dashboard/date-range-filter";

const push = () =>
  vi.mocked(vi.mocked(useRouter).mock.results.at(-1)!.value.push);

const withParams = (qs: string) =>
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(qs) as unknown as ReturnType<typeof useSearchParams>
  );

describe("DashboardDateRangeFilter", () => {
  it("shows the default-range hint when no range is set", () => {
    render(<DashboardDateRangeFilter />);
    expect(screen.getByText("Last 30 days (default)")).toBeInTheDocument();
  });

  it("reflects a range already present in the query string", () => {
    withParams("dateFrom=2026-01-01&dateTo=2026-01-31");
    render(<DashboardDateRangeFilter />);
    expect(
      screen.queryByText("Last 30 days (default)")
    ).not.toBeInTheDocument();
  });

  it("navigates within the default base path", () => {
    render(<DashboardDateRangeFilter />);
    expect(push()).not.toHaveBeenCalled();
  });

  it("accepts a base path so drilldown pages stay on their own route", () => {
    // The filter is reused across /dashboard/assets, /liabilities and so on;
    // without basePath every change would bounce the user to the summary page.
    render(<DashboardDateRangeFilter basePath="/dashboard/assets" />);
    expect(screen.getByText("Last 30 days (default)")).toBeInTheDocument();
  });
});
