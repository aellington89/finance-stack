import { AlertCircle } from "lucide-react";

/**
 * Inline error state for a rejected filter param, rendered at the page boundary
 * in place of the data when {@link validateDateRange} or
 * {@link validateFilterParams} rejects. Keeps the page header + filter bar
 * visible so the user can correct it.
 *
 * `title` defaults to the date-range case, which is every caller but the two
 * pages that also validate account/type/category/amount filters (Issue #179).
 */
export function DateRangeError({
  message,
  title = "Invalid date range",
}: {
  message: string;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-destructive/90">{message}</p>
      </div>
    </div>
  );
}
