/**
 * Percent arithmetic shared by the drilldown queries and their hierarchy
 * builders (Issue #143).
 *
 * These were defined three times, byte for byte: in assets-drilldown.ts,
 * liabilities-drilldown.ts, and inline inside getNetWorthDrivers. Pulling the
 * builders out into pure modules would have made it five, so they live here
 * instead. Like _aggregates.ts this module touches no database, which is what
 * lets the unit project import it.
 */

/** Rounds to two decimal places — the precision every percent column shows. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * `num` as a percent of `den`, rounded to 2 dp. A zero denominator yields 0,
 * which is right for a share ("% of Total" when nothing moved) but wrong for a
 * rate of change — use `pctOrNull` for that.
 */
export const pct = (num: number, den: number): number =>
  den !== 0 ? round2((num / den) * 100) : 0;

/**
 * As `pct`, but a zero denominator yields `null`. `% Change` is undefined when
 * the start balance is zero (e.g. an account opened mid-period), and `null` is
 * what lets the UI render "—" through formatPercentChange instead of a
 * misleading 0.00%.
 */
export const pctOrNull = (num: number, den: number): number | null =>
  den !== 0 ? round2((num / den) * 100) : null;
