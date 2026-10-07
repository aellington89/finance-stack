"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { LiabilityPerformanceData } from "@/lib/queries/liabilities-drilldown";
import {
  signedCurrency,
  formatPercentChange,
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
import { ExpandToggle } from "@/components/dashboard/expand-toggle";
import { SignedChange } from "@/components/dashboard/signed-change";
import { formatCurrency } from "@/lib/format/financial";

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
              return (
                <Fragment key={catKey}>
                  <TableRow
                    ref={setRowRef(catKey)}
                    className="cursor-pointer"
                    onClick={() => toggle(catKey)}
                    data-testid={`row-${catKey}`}
                  >
                    <TableCell className="text-muted-foreground">
                      <ExpandToggle
                        expanded={catOpen}
                        onToggle={() => toggle(catKey)}
                      >
                        {cat.categoryName}
                      </ExpandToggle>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(cat.currentValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <SignedChange value={cat.change}>
                        {signedCurrency(cat.change)}
                      </SignedChange>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <SignedChange value={cat.percentChange}>
                        {formatPercentChange(cat.percentChange)}
                      </SignedChange>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cat.percentOfTotal.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                  {catOpen &&
                    cat.accountTypes.map((type) => {
                      const typeKey = `type:${cat.categoryId}:${type.accountTypeId}`;
                      const typeOpen = expanded.has(typeKey);
                      return (
                        <Fragment key={typeKey}>
                          <TableRow
                            ref={setRowRef(typeKey)}
                            className="cursor-pointer"
                            onClick={() => toggle(typeKey)}
                            data-testid={`row-${typeKey}`}
                          >
                            <TableCell className="text-muted-foreground pl-8">
                              <ExpandToggle
                                expanded={typeOpen}
                                onToggle={() => toggle(typeKey)}
                              >
                                {type.accountTypeName}
                              </ExpandToggle>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(type.currentValue)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <SignedChange value={type.change}>
                                {signedCurrency(type.change)}
                              </SignedChange>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <SignedChange value={type.percentChange}>
                                {formatPercentChange(type.percentChange)}
                              </SignedChange>
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
                                <TableCell className="text-right tabular-nums">
                                  <SignedChange value={acc.change}>
                                    {signedCurrency(acc.change)}
                                  </SignedChange>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <SignedChange value={acc.percentChange}>
                                    {formatPercentChange(acc.percentChange)}
                                  </SignedChange>
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
              <TableCell className="text-right font-bold tabular-nums">
                <SignedChange value={data.totalChange}>
                  {signedCurrency(data.totalChange)}
                </SignedChange>
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                <SignedChange value={data.totalPercentChange}>
                  {formatPercentChange(data.totalPercentChange)}
                </SignedChange>
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
