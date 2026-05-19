import { DashboardTabs } from "./dashboard-tabs";
import { ensureTodayBalances } from "@/lib/queries/rebuild-balance";

// This layout performs a DB write (ensureTodayBalances) on every render,
// so it must never be statically prerendered at build time — otherwise
// `next build` fails with ECONNREFUSED when no database is reachable
// (e.g. inside `docker build`). Forcing dynamic here also covers the
// otherwise-static "Coming Soon" pages nested under /dashboard.
export const dynamic = "force-dynamic";

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
