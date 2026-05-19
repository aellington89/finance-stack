"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface DrilldownTab {
  value: string;
  label: string;
  href: string;
}

/**
 * Drilldown sub-navigation for every top-level dashboard section.
 *
 * The first tab of each section is its "Overview" (the section root). To add a
 * drilldown later: add one entry here and create the matching page — the tab
 * bar and active-state detection update automatically.
 */
export const DRILLDOWN_SECTIONS = {
  summary: [
    { value: "overview", label: "Overview", href: "/dashboard" },
    { value: "net-worth", label: "Net Worth", href: "/dashboard/net-worth" },
    { value: "assets", label: "Assets", href: "/dashboard/assets" },
    { value: "liabilities", label: "Liabilities", href: "/dashboard/liabilities" },
  ],
  accounting: [
    { value: "overview", label: "Overview", href: "/dashboard/accounting" },
    { value: "income", label: "Income", href: "/dashboard/accounting/income" },
    { value: "expenses", label: "Expenses", href: "/dashboard/accounting/expenses" },
    { value: "investments", label: "Investments", href: "/dashboard/accounting/investments" },
    { value: "cash-flow", label: "Cash Flow", href: "/dashboard/accounting/cash-flow" },
    { value: "budget", label: "Budget", href: "/dashboard/accounting/budget" },
  ],
  transactions: [
    { value: "overview", label: "Overview", href: "/dashboard/transactions" },
    { value: "categories", label: "Categories", href: "/dashboard/transactions/categories" },
    { value: "merchants", label: "Merchants", href: "/dashboard/transactions/merchants" },
    { value: "recurring", label: "Recurring", href: "/dashboard/transactions/recurring" },
  ],
  accounts: [
    { value: "overview", label: "Overview", href: "/dashboard/accounts" },
    { value: "activity", label: "Activity", href: "/dashboard/accounts/activity" },
    { value: "reconciliation", label: "Reconciliation", href: "/dashboard/accounts/reconciliation" },
  ],
  "work-expenses": [
    { value: "overview", label: "Overview", href: "/dashboard/work-expenses" },
    { value: "reimbursements", label: "Reimbursements", href: "/dashboard/work-expenses/reimbursements" },
  ],
} satisfies Record<string, DrilldownTab[]>;

export type DrilldownSection = keyof typeof DRILLDOWN_SECTIONS;

/**
 * The active tab is the one whose href is the *longest* prefix of the current
 * path. This keeps "Overview" (the section root) from shadowing its own
 * drilldowns, without each section needing bespoke matching logic.
 */
function getActiveValue(tabs: DrilldownTab[], pathname: string): string {
  let best = tabs[0];
  let bestLen = -1;
  for (const tab of tabs) {
    const isMatch =
      pathname === tab.href || pathname.startsWith(tab.href + "/");
    if (isMatch && tab.href.length > bestLen) {
      best = tab;
      bestLen = tab.href.length;
    }
  }
  return best.value;
}

export function DrilldownTabs({ section }: { section: DrilldownSection }) {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = DRILLDOWN_SECTIONS[section];
  const activeTab = getActiveValue(tabs, pathname);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const tab = tabs.find((t) => t.value === value);
        if (tab) router.push(tab.href);
      }}
    >
      <TabsList variant="line">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
