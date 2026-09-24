import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import {
  DrilldownTabs,
  DRILLDOWN_SECTIONS,
} from "@/components/dashboard/drilldown-tabs";

beforeEach(() => {
  vi.mocked(usePathname).mockReturnValue("/dashboard");
});

const active = () =>
  screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");

describe("DrilldownTabs", () => {
  it("renders one tab per entry in the section", () => {
    render(<DrilldownTabs section="accounting" />);
    expect(screen.getAllByRole("tab")).toHaveLength(
      DRILLDOWN_SECTIONS.accounting.length
    );
    expect(screen.getByRole("tab", { name: "Cash Flow" })).toBeInTheDocument();
  });

  // The whole point of longest-prefix matching: "/dashboard/accounting" is a
  // prefix of "/dashboard/accounting/income", so a naive startsWith would
  // leave Overview selected on every drilldown page.
  it("selects the drilldown, not the section root, on a nested path", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard/accounting/income");
    render(<DrilldownTabs section="accounting" />);
    expect(active()).toHaveTextContent("Income");
  });

  it("selects the section root on the section's own path", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard/accounting");
    render(<DrilldownTabs section="accounting" />);
    expect(active()).toHaveTextContent("Overview");
  });

  it("stays on the drilldown for a path deeper than the tab's href", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard/accounting/income/2026");
    render(<DrilldownTabs section="accounting" />);
    expect(active()).toHaveTextContent("Income");
  });

  // "/dashboard" is the summary root and a prefix of every other section, so
  // this is the case most likely to regress if the matcher is simplified.
  it("does not let the summary root shadow its own drilldowns", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard/net-worth");
    render(<DrilldownTabs section="summary" />);
    expect(active()).toHaveTextContent("Net Worth");
  });

  it("falls back to the first tab when nothing matches", () => {
    vi.mocked(usePathname).mockReturnValue("/somewhere/else");
    render(<DrilldownTabs section="accounts" />);
    expect(active()).toHaveTextContent("Overview");
  });

  it("does not match a sibling path that merely shares a prefix string", () => {
    // "/dashboard/accountsX" must not match the "/dashboard/accounts" tab —
    // the matcher appends "/" rather than using a bare startsWith.
    vi.mocked(usePathname).mockReturnValue("/dashboard/accountsX");
    render(<DrilldownTabs section="accounts" />);
    expect(active()).toHaveTextContent("Overview");
  });

  it.each(Object.keys(DRILLDOWN_SECTIONS) as Array<keyof typeof DRILLDOWN_SECTIONS>)(
    "renders section %s without error",
    (section) => {
      render(<DrilldownTabs section={section} />);
      expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    }
  );
});
