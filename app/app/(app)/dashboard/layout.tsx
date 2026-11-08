import { DashboardTabs } from "./dashboard-tabs";
import { ensureTodayBalances } from "@/lib/queries/rebuild-balance";

// This layout performs a DB write (ensureTodayBalances) on every render,
// so it must never be statically prerendered at build time — otherwise
// `next build` fails with ECONNREFUSED when no database is reachable
// (e.g. inside `docker build`). Forcing dynamic here also covers the
// otherwise-static "Coming Soon" pages nested under /dashboard.
//
// This call is not what makes today's balances visible to a page (Issue #408).
// The layout renders in parallel with its page, and a soft navigation between
// tabs does not render it at all, so every page that reads today's balances
// awaits ensureTodayBalances() itself. It stays here so that a hard load of any
// tab, balance-reading or not, carries balances forward. It is cache()-wrapped,
// so a page that also calls it shares this one execution.
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
