import { AlertCircle } from "lucide-react";

/**
 * Inline error state for an invalid date range, rendered at the page boundary
 * in place of the data when {@link validateDateRange} rejects the params. Keeps
 * the page header + date filter visible so the user can correct the range.
 */
export function DateRangeError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium">Invalid date range</p>
        <p className="text-destructive/90">{message}</p>
      </div>
    </div>
  );
}
