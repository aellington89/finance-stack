"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  { value: "summary", label: "Summary", href: "/dashboard" },
  { value: "accounting", label: "Personal Accounting", href: "/dashboard/accounting" },
  { value: "transactions", label: "Transactions", href: "/dashboard/transactions" },
  { value: "accounts", label: "Accounts", href: "/dashboard/accounts" },
  { value: "work-expenses", label: "Work Expenses", href: "/dashboard/work-expenses" },
] as const;

function getActiveTab(pathname: string): string {
  // Match the most specific path first
  for (const tab of tabs) {
    if (tab.href !== "/dashboard" && pathname.startsWith(tab.href)) {
      return tab.value;
    }
  }
  return "summary";
}

export function DashboardTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = getActiveTab(pathname);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const tab = tabs.find((t) => t.value === value);
        if (tab) router.push(tab.href);
      }}
    >
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
