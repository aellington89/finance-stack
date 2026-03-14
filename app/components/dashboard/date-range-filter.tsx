"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DateRangePicker } from "@/components/ui/date-range-picker";

export function DashboardDateRangeFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Default to last 30 days when no URL param is set
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const handleChange = (from: string | undefined, to: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("dateFrom", from);
    else params.delete("dateFrom");
    if (to) params.set("dateTo", to);
    else params.delete("dateTo");
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  };

  return (
    <DateRangePicker
      dateFrom={searchParams.get("dateFrom") ?? defaultFrom}
      dateTo={searchParams.get("dateTo") ?? undefined}
      onChange={handleChange}
      className="w-[280px]"
    />
  );
}
