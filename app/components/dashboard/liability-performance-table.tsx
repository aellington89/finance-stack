"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { LiabilityPerformanceData } from "@/lib/queries/liabilities-drilldown";
import {
  signedCurrency,
  signedPercent,
  changeColor,
} from "@/lib/format/financial";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

// `% Change` is undefined for accounts opened mid-period (start_balance = 0).
// Render an em-dash so the column reads cleanly without claiming 0% or ∞%.
export const formatPercentChange = (n: number | null): string =>
  n === null ? "—" : signedPercent(n);

interface LiabilityPerformanceTableProps {
  data: LiabilityPerformanceData;
}

export function LiabilityPerformanceTable({
  data,
}: LiabilityPerformanceTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rowRefs = useRef<Map<string, HTMLTableRowElement | null>>(new Map());
  const pendingScroll = useRef<{ key: string; top: number } | null>(null);

  const toggle = (key: string) => {
    const row = rowRefs.current.get(key);
    if (row) {
      pendingScroll.current = {
        key,
        top: row.getBoundingClientRect().top,
      };
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useLayoutEffect(() => {
    const pending = pendingScroll.current;
    if (!pending) return;
    const row = rowRefs.current.get(pending.key);
    if (row) {
      const delta = row.getBoundingClientRect().top - pending.top;
      if (delta !== 0) window.scrollBy(0, delta);
    }
    pendingScroll.current = null;
  }, [expanded]);

  const setRowRef = (key: string) => (el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  };

  // `% of Total` divides current value by total current value. Both are
  // negative, so the ratio is positive — display as a normal percent.
  const totalIsNonZero = data.totalCurrentValue !== 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Liability Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">% Change</TableHead>
              <TableHead className="text-right">% of Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.categories.map((cat) => {
              const catKey = `cat:${cat.categoryId}`;
              const catOpen = expanded.has(catKey);
              const Chevron = catOpen ? ChevronDown : ChevronRight;
              return (
                <Fragment key={catKey}>
                  <TableRow
                    ref={setRowRef(catKey)}
                    className="cursor-pointer"
                    onClick={() => toggle(catKey)}
                    data-testid={`row-${catKey}`}
                  >
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Chevron className="h-4 w-4" />
                        {cat.categoryName}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(cat.currentValue)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${changeColor(cat.change)}`}
                    >
                      {signedCurrency(cat.change)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        cat.percentChange !== null
                          ? changeColor(cat.percentChange)
                          : ""
                      }`}
                    >
                      {formatPercentChange(cat.percentChange)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cat.percentOfTotal.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                  {catOpen &&
                    cat.accountTypes.map((type) => {
                      const typeKey = `type:${cat.categoryId}:${type.accountTypeId}`;
                      const typeOpen = expanded.has(typeKey);
                      const TypeChevron = typeOpen
                        ? ChevronDown
                        : ChevronRight;
                      return (
                        <Fragment key={typeKey}>
                          <TableRow
                            ref={setRowRef(typeKey)}
                            className="cursor-pointer"
                            onClick={() => toggle(typeKey)}
                            data-testid={`row-${typeKey}`}
                          >
                            <TableCell className="text-muted-foreground pl-8">
                              <span className="inline-flex items-center gap-1">
                                <TypeChevron className="h-4 w-4" />
                                {type.accountTypeName}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(type.currentValue)}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums ${changeColor(type.change)}`}
                            >
                              {signedCurrency(type.change)}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums ${
                                type.percentChange !== null
                                  ? changeColor(type.percentChange)
                                  : ""
                              }`}
                            >
                              {formatPercentChange(type.percentChange)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {type.percentOfTotal.toFixed(2)}%
                            </TableCell>
                          </TableRow>
                          {typeOpen &&
                            type.accounts.map((acc) => (
                              <TableRow
                                key={`acc:${cat.categoryId}:${type.accountTypeId}:${acc.accountId}`}
                                data-testid={`row-acc:${acc.accountId}`}
                              >
                                <TableCell className="text-muted-foreground pl-14">
                                  {acc.accountName}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(acc.currentValue)}
                                </TableCell>
                                <TableCell
                                  className={`text-right tabular-nums ${changeColor(acc.change)}`}
                                >
                                  {signedCurrency(acc.change)}
                                </TableCell>
                                <TableCell
                                  className={`text-right tabular-nums ${
                                    acc.percentChange !== null
                                      ? changeColor(acc.percentChange)
                                      : ""
                                  }`}
                                >
                                  {formatPercentChange(acc.percentChange)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {acc.percentOfTotal.toFixed(2)}%
                                </TableCell>
                              </TableRow>
                            ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">Total</TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {formatCurrency(data.totalCurrentValue)}
              </TableCell>
              <TableCell
                className={`text-right font-bold tabular-nums ${changeColor(data.totalChange)}`}
              >
                {signedCurrency(data.totalChange)}
              </TableCell>
              <TableCell
                className={`text-right font-bold tabular-nums ${
                  data.totalPercentChange !== null
                    ? changeColor(data.totalPercentChange)
                    : ""
                }`}
              >
                {formatPercentChange(data.totalPercentChange)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {totalIsNonZero ? "100.00%" : "0.00%"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
