import { addDays, format, getQuarter } from "date-fns";
import type { TimeGrouping } from "@/lib/queries/accounting";
import type { TooltipDatePayload } from "@/components/ui/chart";
import { parseChartDate } from "@/lib/format/dates";

/**
 * Axis-tick and tooltip-label formatters for the accounting chart, one arm per
 * `TimeGrouping`.
 *
 * Extracted from accounting-chart.tsx by Issue #296. These are the branchiest
 * functions in components/charts/ — eleven groupings across two factories — and
 * they were unreachable by any test while they lived beside the JSX, because
 * recharts never invokes a formatter under jsdom (ResponsiveContainer has no
 * layout there, so no axis is ever drawn).
 *
 * The two halves must agree: a grouping formatted one way on the axis and
 * another in the tooltip is the bug this pairing exists to prevent.
 */

export const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `M.D.YYYY`, used for the two ends of a week range. */
export function formatDotDate(d: Date) {
  return `${d.getMonth() + 1}.${d.getDate()}.${d.getFullYear()}`;
}

export function makeTickFormatter(grouping: TimeGrouping) {
  if (grouping === "day") {
    return (dateStr: string) => format(parseChartDate(dateStr), "MMM d");
  }
  if (grouping === "week") {
    // Show last day of week period
    return (dateStr: string) => {
      const end = addDays(parseChartDate(dateStr), 6);
      return format(end, "MMM d");
    };
  }
  if (grouping === "month") {
    return (dateStr: string) => format(parseChartDate(dateStr), "MMMM yyyy");
  }
  if (grouping === "quarter") {
    return (dateStr: string) => {
      const d = parseChartDate(dateStr);
      return `Q${getQuarter(d)} ${d.getFullYear()}`;
    };
  }
  if (grouping === "year") {
    return (dateStr: string) => format(parseChartDate(dateStr), "yyyy");
  }
  if (grouping === "day_of_week") {
    return (val: string) => DOW_NAMES[Number(val)] ?? val;
  }
  if (grouping === "month_of_year") {
    return (val: string) => MONTH_NAMES[Number(val)] ?? val;
  }
  if (grouping === "quarter_of_year") {
    return (val: string) => `Q${val}`;
  }
  // day_of_month, day_of_year, week_of_year — just show the number
  return (val: string) => val;
}

export function makeTooltipLabelFormatter(grouping: TimeGrouping) {
  if (grouping === "day") {
    return (_: unknown, payload: TooltipDatePayload) => {
      if (!payload?.[0]?.payload?.date) return "";
      return format(parseChartDate(payload[0].payload.date), "MMM d, yyyy");
    };
  }
  if (grouping === "week") {
    return (_: unknown, payload: TooltipDatePayload) => {
      if (!payload?.[0]?.payload?.date) return "";
      const start = parseChartDate(payload[0].payload.date);
      const end = addDays(start, 6);
      return `${formatDotDate(start)} - ${formatDotDate(end)}`;
    };
  }
  if (grouping === "month") {
    return (_: unknown, payload: TooltipDatePayload) => {
      if (!payload?.[0]?.payload?.date) return "";
      return format(parseChartDate(payload[0].payload.date), "MMMM yyyy");
    };
  }
  if (grouping === "quarter") {
    return (_: unknown, payload: TooltipDatePayload) => {
      if (!payload?.[0]?.payload?.date) return "";
      const d = parseChartDate(payload[0].payload.date);
      return `Q${getQuarter(d)} ${d.getFullYear()}`;
    };
  }
  if (grouping === "year") {
    return (_: unknown, payload: TooltipDatePayload) => {
      if (!payload?.[0]?.payload?.date) return "";
      return format(parseChartDate(payload[0].payload.date), "yyyy");
    };
  }
  if (grouping === "day_of_week") {
    return (_: unknown, payload: TooltipDatePayload) =>
      DOW_NAMES[Number(payload?.[0]?.payload?.date)] ?? String(payload?.[0]?.payload?.date);
  }
  if (grouping === "month_of_year") {
    return (_: unknown, payload: TooltipDatePayload) =>
      MONTH_NAMES[Number(payload?.[0]?.payload?.date)] ?? String(payload?.[0]?.payload?.date);
  }
  if (grouping === "quarter_of_year") {
    return (_: unknown, payload: TooltipDatePayload) =>
      `Q${payload?.[0]?.payload?.date}`;
  }
  return (_: unknown, payload: TooltipDatePayload) =>
    String(payload?.[0]?.payload?.date ?? "");
}
