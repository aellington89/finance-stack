import { DashboardTabs } from "./dashboard-tabs";
import { ensureTodayBalances } from "@/lib/queries/rebuild-balance";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureTodayBalances();

  return (
    <div className="p-6">
      <DashboardTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
