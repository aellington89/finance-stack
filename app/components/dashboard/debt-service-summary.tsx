"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { DebtServiceData } from "@/lib/queries/liabilities-drilldown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

interface DebtServiceSummaryProps {
  data: DebtServiceData;
}

/**
 * Sign convention recap for this card:
 *   - `totalPayments` is positive on the liability side (paydown).
 *   - `interestAccrued` is negative on the liability side (added debt).
 *     We display its absolute value as "interest cost".
 *   - `principalPaid = totalPayments + interestAccrued`, naturally positive
 *     when payments exceed interest.
 */
export function DebtServiceSummary({ data }: DebtServiceSummaryProps) {
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

  const interestCost = Math.abs(data.interestAccrued);
  const isEmpty =
    data.totalPayments === 0 &&
    data.interestAccrued === 0 &&
    data.categories.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Debt Service</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEmpty ? (
          <div className="text-sm text-muted-foreground">
            No payment or interest activity in the selected range.
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">
                  Total Payments
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
                  {formatCurrency(data.totalPayments)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">
                  Interest Accrued
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-red-600 dark:text-red-400">
                  {formatCurrency(interestCost)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">
                  Principal Paid (estimated)
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-green-600 dark:text-green-400">
                  {formatCurrency(data.principalPaid)}
                </div>
              </div>
            </div>

            {data.categories.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
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
                            {formatCurrency(cat.totalPayments)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Math.abs(cat.interestAccrued))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(cat.principalPaid)}
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
                                    {formatCurrency(type.totalPayments)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(
                                      Math.abs(type.interestAccrued)
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(type.principalPaid)}
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
                                        {formatCurrency(acc.totalPayments)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {formatCurrency(
                                          Math.abs(acc.interestAccrued)
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {formatCurrency(acc.principalPaid)}
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
                      {formatCurrency(data.totalPayments)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatCurrency(interestCost)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatCurrency(data.principalPaid)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}

            <p className="text-xs text-muted-foreground">
              Principal/interest split is estimated from accrued-interest
              categories and may not match servicer statements exactly.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
