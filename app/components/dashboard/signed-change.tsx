import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { amountColorClass } from "@/lib/format/financial";

interface SignedChangeProps {
  /**
   * Picks the icon and the colour. `null` — an undefined % change, see
   * formatPercentChange — gets neither, and neither does zero.
   */
  value: number | null;
  /** The figure as displayed, e.g. `signedCurrency(value)`. */
  children: ReactNode;
  className?: string;
}

/**
 * A gain or a loss: the figure in green or red *and* a trend icon, so which
 * way it moved is not carried by colour alone (Issue #144, WCAG 1.4.1).
 *
 * The icon is for a sighted reader who cannot tell the two colours apart.
 * Assistive tech skips it — lucide marks an unlabelled icon aria-hidden —
 * because the `+`/`-` that signedCurrency and signedPercent put in the text
 * already says the same thing out loud. The figure stays a text node of its
 * own, so `getByText("+$5,000.00")` still finds it.
 *
 * The icon and the gap beside it are sized in `em`, so they track whatever
 * size the figure is set in. A full 1em, because the trend glyph only fills
 * about half its box: at 0.8em the arrow in a table cell was a few pixels
 * tall, too faint to tell up from down.
 *
 * Only for changes. A balance or a transaction amount takes amountColorClass on
 * its own: its sign is what it *is*, not which way it moved, and a down arrow
 * on a credit card balance would read as "this went down".
 */
export function SignedChange({ value, children, className }: SignedChangeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.25em]",
        value !== null && amountColorClass(value),
        className
      )}
    >
      <TrendIcon value={value} className="size-[1em]" />
      {children}
    </span>
  );
}

/**
 * The icon on its own, in the same colour, for a figure with no room beside
 * it. The text-5xl Period Change KPI is the case: its card is a quarter of
 * the page from `lg` up, and an icon on the figure's line pushed a four-figure
 * change past the card's clipped edge at 1440px. The KPI keeps
 * amountColorClass on the figure and puts this at the end of its title row.
 * Renders nothing for null or zero, like SignedChange.
 */
export function TrendIcon({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  if (value === null) return null;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : null;
  if (Icon === null) return null;

  return <Icon className={cn("shrink-0", amountColorClass(value), className)} />;
}
