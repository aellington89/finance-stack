"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { ArrowUpIcon, ArrowDownIcon, ArrowUpDownIcon } from "lucide-react";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { amountColorClass } from "@/components/accounts/accounts-table";
import type { SortableColumn, SortDirection } from "@/lib/queries/transactions";

interface TransactionRow {
  transactionId: number | null;
  transactionDescription: string | null;
  transactionDate: string | null;
  amount: string | null;
  accountName: string | null;
  relatedAccountName: string | null;
  transactionType: string | null;
  transactionCategory: string | null;
  accountTypeCategory: string | null;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-");
  return `${month}/${day}/${year}`;
}

function SortableHead({
  label,
  column,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  label: string;
  column: SortableColumn;
  currentSort?: SortableColumn;
  currentDir?: SortDirection;
  onSort: (column: SortableColumn) => void;
  className?: string;
}) {
  const isActive = currentSort === column;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 py-0.5 rounded"
      >
        {label}
        {isActive ? (
          currentDir === "asc" ? (
            <ArrowUpIcon className="size-3.5" />
          ) : (
            <ArrowDownIcon className="size-3.5" />
          )
        ) : (
          <ArrowUpDownIcon className="size-3.5 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  );
}

export function TransactionList({
  transactions,
  hasFilters = false,
  sortBy,
  sortDir,
}: {
  transactions: TransactionRow[];
  hasFilters?: boolean;
  sortBy?: SortableColumn;
  sortDir?: SortDirection;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSort = useCallback(
    (column: SortableColumn) => {
      const params = new URLSearchParams(searchParams.toString());

      if (sortBy === column) {
        // Toggle direction
        params.set("sortDir", sortDir === "asc" ? "desc" : "asc");
      } else {
        // New column, default to ascending
        params.set("sortBy", column);
        params.set("sortDir", "asc");
      }

      const qs = params.toString();
      router.replace(`/dashboard/transactions${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams, sortBy, sortDir]
  );

  if (transactions.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        {hasFilters
          ? "No transactions match the current filters."
          : "No transactions yet."}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead label="Date" column="transactionDate" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
          <SortableHead label="Description" column="transactionDescription" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
          <SortableHead label="Amount" column="amount" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} className="text-right" />
          <SortableHead label="Account" column="accountName" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
          <SortableHead label="Type" column="transactionType" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
          <SortableHead label="Category" column="transactionCategory" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((txn) => {
          const amount = Number(txn.amount ?? 0);
          return (
            <TableRow key={txn.transactionId}>
              <TableCell>{formatDate(txn.transactionDate)}</TableCell>
              <TableCell>{txn.transactionDescription}</TableCell>
              <TableCell
                className={cn(
                  "text-right",
                  amountColorClass(amount)
                )}
              >
                {currencyFormatter.format(amount)}
              </TableCell>
              <TableCell>{txn.accountName}</TableCell>
              <TableCell>{txn.transactionType}</TableCell>
              <TableCell>{txn.transactionCategory}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
