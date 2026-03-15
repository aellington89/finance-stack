"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowUpDownIcon,
  Settings2Icon,
} from "lucide-react";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { amountColorClass } from "@/components/accounts/accounts-table";
import type { SortableColumn, SortDirection } from "@/lib/queries/transactions";

// ── Types ──

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

export type ColumnKey =
  | "date"
  | "description"
  | "amount"
  | "account"
  | "type"
  | "category";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  sortColumn: SortableColumn;
  headClassName?: string;
  cellClassName?: string;
  render: (txn: TransactionRow) => React.ReactNode;
}

// ── Helpers ──

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-");
  return `${month}/${day}/${year}`;
}

// ── Column definitions ──

const COLUMNS: ColumnDef[] = [
  {
    key: "date",
    label: "Date",
    sortColumn: "transactionDate",
    render: (txn) => formatDate(txn.transactionDate),
  },
  {
    key: "description",
    label: "Description",
    sortColumn: "transactionDescription",
    render: (txn) => txn.transactionDescription,
  },
  {
    key: "amount",
    label: "Amount",
    sortColumn: "amount",
    headClassName: "text-right",
    cellClassName: "text-right",
    render: (txn) => {
      const amount = Number(txn.amount ?? 0);
      return (
        <span className={amountColorClass(amount)}>
          {currencyFormatter.format(amount)}
        </span>
      );
    },
  },
  {
    key: "account",
    label: "Account",
    sortColumn: "accountName",
    render: (txn) => txn.accountName,
  },
  {
    key: "type",
    label: "Type",
    sortColumn: "transactionType",
    render: (txn) => txn.transactionType,
  },
  {
    key: "category",
    label: "Category",
    sortColumn: "transactionCategory",
    render: (txn) => txn.transactionCategory,
  },
];

const ALL_COLUMN_KEYS: ColumnKey[] = COLUMNS.map((c) => c.key);

// ── Column visibility (localStorage) ──

const STORAGE_KEY = "txn-visible-columns";

function loadVisibleColumns(): Set<ColumnKey> {
  if (typeof window === "undefined") return new Set(ALL_COLUMN_KEYS);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      const valid = parsed.filter((k): k is ColumnKey =>
        ALL_COLUMN_KEYS.includes(k as ColumnKey)
      );
      if (valid.length > 0) return new Set(valid);
    }
  } catch {
    // ignore
  }
  return new Set(ALL_COLUMN_KEYS);
}

// ── Sub-components ──

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

// ── Main component ──

export function TransactionList({
  transactions,
  hasFilters = false,
  sortBy,
  sortDir,
  page,
  pageSize,
  totalCount,
}: {
  transactions: TransactionRow[];
  hasFilters?: boolean;
  sortBy?: SortableColumn;
  sortDir?: SortDirection;
  page: number;
  pageSize: number;
  totalCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Column visibility — initialize with all, then load from localStorage on mount
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    () => new Set(ALL_COLUMN_KEYS)
  );

  useEffect(() => {
    setVisibleColumns(loadVisibleColumns());
  }, []);

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const filteredColumns = COLUMNS.filter((c) => visibleColumns.has(c.key));

  // Sort handler — resets page to 1
  const handleSort = useCallback(
    (column: SortableColumn) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");

      if (sortBy === column) {
        params.set("sortDir", sortDir === "asc" ? "desc" : "asc");
      } else {
        params.set("sortBy", column);
        params.set("sortDir", "asc");
      }

      const qs = params.toString();
      router.replace(`/dashboard/transactions${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams, sortBy, sortDir]
  );

  // Pagination handler
  const handlePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newPage <= 1) {
        params.delete("page");
      } else {
        params.set("page", String(newPage));
      }
      const qs = params.toString();
      router.replace(`/dashboard/transactions${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams]
  );

  return (
    <div>
      {/* Toolbar: column visibility toggle */}
      <div className="flex justify-end mb-2">
        <Popover>
          <PopoverTrigger
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium ring-offset-background hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Settings2Icon className="size-3.5" />
            Columns
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44">
            <div className="flex flex-col gap-0.5">
              {COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 text-sm cursor-pointer px-1 py-1 rounded hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="accent-primary"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Table or empty state */}
      {transactions.length === 0 ? (
        <p className="text-muted-foreground">
          {hasFilters
            ? "No transactions match the current filters."
            : "No transactions yet."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {filteredColumns.map((col) => (
                <SortableHead
                  key={col.key}
                  label={col.label}
                  column={col.sortColumn}
                  currentSort={sortBy}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className={col.headClassName}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((txn) => (
              <TableRow key={txn.transactionId}>
                {filteredColumns.map((col) => (
                  <TableCell key={col.key} className={col.cellClassName}>
                    {col.render(txn)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination controls */}
      <div className="flex items-center justify-between pt-4">
        <p className="text-sm text-muted-foreground">
          {totalCount} transaction{totalCount !== 1 ? "s" : ""}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm tabular-nums">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
