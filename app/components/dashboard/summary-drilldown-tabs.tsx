"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const drilldownTabs = [
  { value: "overview", label: "Overview", href: "/dashboard" },
  { value: "net-worth", label: "Net Worth", href: "/dashboard/net-worth" },
  { value: "assets", label: "Assets", href: "/dashboard/assets" },
  { value: "liabilities", label: "Liabilities", href: "/dashboard/liabilities" },
] as const;

function getActiveDrilldown(pathname: string): string {
  for (const tab of drilldownTabs) {
    if (tab.href !== "/dashboard" && pathname.startsWith(tab.href)) {
      return tab.value;
    }
  }
  return "overview";
}

export function SummaryDrilldownTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = getActiveDrilldown(pathname);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const tab = drilldownTabs.find((t) => t.value === value);
        if (tab) router.push(tab.href);
      }}
    >
      <TabsList variant="line">
        {drilldownTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
