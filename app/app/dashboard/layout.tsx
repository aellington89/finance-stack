// Dashboard sub-layout — shared chrome for all dashboard pages.
// Will be expanded to include dashboard-specific navigation tabs
// (Overview, Accounting, Work Expenses) once UI components are
// installed (Issue #20).

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
