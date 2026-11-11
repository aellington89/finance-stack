import { CircleCheck, Clock, Hourglass, TriangleAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  BalanceTransferTrackerRow,
  TrackerStatus,
  TransferTerms,
} from "@/lib/queries/balance-transfer-payoff";
import { formatApr, formatCurrency } from "@/lib/format/financial";
import { formatLongDate } from "@/lib/format/dates";

interface BalanceTransferTrackerProps {
  rows: BalanceTransferTrackerRow[];
}

const money = (n: number | null): string => (n === null ? "—" : formatCurrency(n));

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "$6,000.00 from Visa, fee $180.00": one transfer's own terms. */
function transferLine(t: TransferTerms): string {
  const fee = t.feeAmount === null ? "no fee linked" : `fee ${formatCurrency(t.feeAmount)}`;
  return `${formatCurrency(t.transferredAmount)} from ${t.sourceAccountName ?? "External"}, ${fee}`;
}

/** The status as words. The icon beside it repeats the meaning and is hidden. */
export function statusText(status: TrackerStatus): string {
  switch (status.kind) {
    case "on_track":
      return "On track";
    case "behind":
      return `Behind — ${formatCurrency(status.shortPerMonth)}/mo short`;
    case "expiring":
      return `Expires in ${plural(status.daysLeft, "day")}`;
    case "too_new":
      return "Too new to project";
  }
}

const STATUS_ICON = {
  on_track: CircleCheck,
  behind: TriangleAlert,
  expiring: Clock,
  too_new: Hourglass,
} as const;

/**
 * The Liabilities drilldown's Balance transfers card (Issue #417): one row per
 * card with a promo active on the range's end date, tracking whether the
 * balance will be cleared before the promo ends.
 *
 * A card containing a table rather than KPI figures: the text-5xl row above
 * already clips six-figure values (#356). Status is text with an icon beside
 * it, not colour (#144), and stays in the foreground colour rather than the
 * gain/loss greens and reds that fail contrast in light mode (#406).
 */
export function BalanceTransferTracker({ rows }: BalanceTransferTrackerProps) {
  const asOf = rows[0]?.asOf;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Balance Transfers</CardTitle>
        {asOf && (
          <CardDescription>
            Promos active on {formatLongDate(asOf)}. Pace is the card&apos;s net
            paydown per month, leaving out each transfer&apos;s own posting and
            fee. While a promo is active, the card&apos;s whole balance counts
            as promotional, including new purchases.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {/* w-0 + min-w-full: the table fills the card but adds nothing to the
            page's min-content width. Without it, its no-wrap cells widened the
            whole page at 1280px instead of scrolling inside the card. */}
        <div className="w-0 min-w-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer</TableHead>
                <TableHead>Promo</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead className="text-right">Needed / mo</TableHead>
                <TableHead className="text-right">Pace / mo</TableHead>
                <TableHead className="text-right">Left at expiry</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const Icon = STATUS_ICON[row.status.kind];
                return (
                  <TableRow
                    key={row.accountId}
                    data-testid={`balance-transfer-row-${row.accountId}`}
                    className="align-top"
                  >
                    <TableCell className="min-w-48 whitespace-normal">
                      <div className="font-medium">{row.accountName}</div>
                      <div className="text-xs text-muted-foreground">
                        {transferLine(row.primary)}
                      </div>
                      {row.others.map((other) => (
                        <div
                          key={other.balanceTransferId}
                          className="text-xs text-muted-foreground"
                        >
                          Also {transferLine(other)}, {formatApr(other.promoApr)} until{" "}
                          {formatLongDate(other.promoEndDate)}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="min-w-40 whitespace-normal">
                      <div>
                        {formatApr(row.primary.promoApr)} until{" "}
                        {formatLongDate(row.primary.promoEndDate)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {plural(row.monthsRemaining, "month")} left
                        {row.monthlyInterest !== null &&
                          `, ${formatCurrency(row.monthlyInterest)}/mo interest`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.debt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.requiredPerMonth)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>
                        <span className="text-xs text-muted-foreground">3 mo </span>
                        {money(row.threeMonthPace)}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">range </span>
                        {money(row.rangePace)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(row.projectedAtExpiry)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {statusText(row.status)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
