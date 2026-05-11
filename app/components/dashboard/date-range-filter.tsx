"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DateRangePicker } from "@/components/ui/date-range-picker";

export function DashboardDateRangeFilter({ basePath = "/dashboard" }: { basePath?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = (from: string | undefined, to: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("dateFrom", from);
    else params.delete("dateFrom");
    if (to) params.set("dateTo", to);
    else params.delete("dateTo");
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  };

  return (
    <DateRangePicker
      dateFrom={searchParams.get("dateFrom") ?? undefined}
      dateTo={searchParams.get("dateTo") ?? undefined}
      onChange={handleChange}
      placeholder="Last 30 days (default)"
      className="w-[280px]"
    />
  );
}
