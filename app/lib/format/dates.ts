import { format } from "date-fns";

/**
 * Parses a `YYYY-MM-DD` column value as *local* midnight.
 *
 * The appended `T00:00:00` is the whole point and is not decoration: a bare
 * `new Date("2026-04-19")` is parsed as UTC midnight, which renders as the
 * previous day for every viewer west of Greenwich. Every chart axis in the app
 * reads dates this way.
 *
 * Was two copies (`parseDate`) before Issue #296.
 */
export const parseChartDate = (dateStr: string): Date =>
  new Date(dateStr + "T00:00:00");

/**
 * The short axis label — "Apr 19". Was four identical copies (`formatDate`).
 */
export const formatAxisDate = (dateStr: string): string =>
  format(parseChartDate(dateStr), "MMM d");
