/**
 * The canonical money format for this app: always two decimals, always USD.
 *
 * Issue #296 made this exported rather than private. It had been copy-pasted,
 * byte for byte, into six dashboard components and eleven chart components
 * (there as `formatCurrencyFull`) — seventeen definitions of one function, none
 * of which could drift visibly because they were identical, and all of which
 * would have had to be found and edited together if the format ever changed.
 */
export const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

/**
 * Axis-label money: "$1.2K" rather than "$1,234.56". Charts use this for tick
 * labels, where the full format does not fit, and `formatCurrency` for the
 * tooltip, where it does. Was ten identical copies before #296.
 */
export const formatCurrencyCompact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

export function signedCurrency(n: number): string {
  const formatted = formatCurrency(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

export function signedPercent(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${abs}%`;
  if (n < 0) return `-${abs}%`;
  return `${abs}%`;
}

/**
 * Tailwind text-color class for a signed monetary value — amounts, balances,
 * and period changes. Green for positive, red for negative, none for zero.
 */
export function amountColorClass(n: number): string {
  if (n > 0) return "text-green-600 dark:text-green-400";
  if (n < 0) return "text-red-600 dark:text-red-400";
  return "";
}

// `% Change` is undefined for accounts opened mid-period (start_balance = 0).
// Render an em-dash so the column reads cleanly without claiming 0% or ∞%.
export const formatPercentChange = (n: number | null): string =>
  n === null ? "—" : signedPercent(n);
