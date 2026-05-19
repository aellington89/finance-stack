import type { ReactNode } from "react";

/**
 * Standard dashboard page header.
 *
 * Layout contract shared by every page under /dashboard:
 *   [optional sub-navigation tabs]
 *   <h1> page title
 *   [optional filter bar, on its own row directly below the title]
 *
 * Pages should render this as the first child of a `space-y-6` container,
 * followed by their content.
 */
export function DashboardPageHeader({
  title,
  subnav,
  filters,
}: {
  title: string;
  subnav?: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {subnav}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {filters ? <div className="mt-3">{filters}</div> : null}
      </div>
    </div>
  );
}
