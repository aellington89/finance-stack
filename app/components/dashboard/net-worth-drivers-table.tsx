"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { DriversData } from "@/lib/queries/net-worth-drilldown";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandToggle } from "@/components/dashboard/expand-toggle";
import { SignedChange } from "@/components/dashboard/signed-change";
import { signedCurrency, signedPercent } from "@/lib/format/financial";

interface NetWorthDriversTableProps {
  data: DriversData;
}

export function NetWorthDriversTable({ data }: NetWorthDriversTableProps) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Net Worth Drivers
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Type Category</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">% of Parent</TableHead>
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
                      <SignedChange value={cat.change}>
                        {signedCurrency(cat.change)}
                      </SignedChange>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      —
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <SignedChange value={cat.percentOfTotal}>
                        {signedPercent(cat.percentOfTotal)}
                      </SignedChange>
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
                              <SignedChange value={type.change}>
                                {signedCurrency(type.change)}
                              </SignedChange>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <SignedChange value={type.percentOfParent}>
                                {signedPercent(type.percentOfParent)}
                              </SignedChange>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <SignedChange value={type.percentOfTotal}>
                                {signedPercent(type.percentOfTotal)}
                              </SignedChange>
                            </TableCell>
                          </TableRow>
                          {typeOpen &&
                            type.accounts.map((acc) => (
                              <TableRow
                                key={`acc:${cat.categoryId}:${type.accountTypeId}:${acc.accountId}`}
                              >
                                <TableCell className="text-muted-foreground pl-14">
                                  {acc.accountName}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <SignedChange value={acc.change}>
                                    {signedCurrency(acc.change)}
                                  </SignedChange>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <SignedChange value={acc.percentOfParent}>
                                    {signedPercent(acc.percentOfParent)}
                                  </SignedChange>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <SignedChange value={acc.percentOfTotal}>
                                    {signedPercent(acc.percentOfTotal)}
                                  </SignedChange>
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
                <SignedChange value={data.totalChange}>
                  {signedCurrency(data.totalChange)}
                </SignedChange>
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums text-muted-foreground">
                —
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {data.totalChange !== 0 ? "100.00%" : "0.00%"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
