import { DashboardTabs } from "./dashboard-tabs";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="mt-4">
        <DashboardTabs />
      </div>
      <div className="mt-6">{children}</div>
    </main>
  );
}
