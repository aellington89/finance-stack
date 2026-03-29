import { DashboardTabs } from "./dashboard-tabs";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="p-6">
      <DashboardTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
