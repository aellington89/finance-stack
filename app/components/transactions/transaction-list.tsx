"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowUpDownIcon,
  PencilIcon,
  Settings2Icon,
  Trash2Icon,
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
import { amountColorClass } from "@/lib/format/financial";
import type { SortableColumn, SortDirection } from "@/lib/queries/transactions";
import { TransactionEditRow } from "@/components/transactions/transaction-edit-row";
import { TransactionDeleteDialog } from "@/components/transactions/transaction-delete-dialog";
import {
  VISIBLE_COLUMNS_COOKIE,
  VISIBLE_COLUMNS_COOKIE_MAX_AGE,
  type ColumnKey,
} from "@/components/transactions/transaction-columns";

// ── Types ──

interface TransactionRow {
  transactionId: number | null;
  transactionDescription: string | null;
  transactionDate: string | null;
  amount: string | null;
  accountId: number | null;
  relatedAccountId: number | null;
  accountName: string | null;
  relatedAccountName: string | null;
  transactionType: string | null;
  transactionTypeId: number | null;
  transactionCategory: string | null;
  transactionCategoryId: number | null;
  accountTypeCategory: string | null;
}

interface LookupOption {
  id: number;
  name: string;
}

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
    headClassName: "w-28",
    render: (txn) => formatDate(txn.transactionDate),
  },
  {
    key: "description",
    label: "Description",
    sortColumn: "transactionDescription",
    headClassName: "w-80",
    cellClassName: "truncate",
    render: (txn) => txn.transactionDescription,
  },
  {
    key: "amount",
    label: "Amount",
    sortColumn: "amount",
    headClassName: "w-32 text-right",
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
    headClassName: "w-44",
    cellClassName: "truncate",
    render: (txn) => txn.accountName,
  },
  {
    key: "relatedAccount",
    label: "Related Account",
    sortColumn: "relatedAccountName",
    headClassName: "w-44",
    cellClassName: "truncate",
    render: (txn) => txn.relatedAccountName,
  },
  {
    key: "type",
    label: "Type",
    sortColumn: "transactionType",
    headClassName: "w-28",
    cellClassName: "truncate",
    render: (txn) => txn.transactionType,
  },
  {
    key: "category",
    label: "Category",
    sortColumn: "transactionCategory",
    headClassName: "w-40",
    cellClassName: "truncate",
    render: (txn) => txn.transactionCategory,
  },
];

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
  accounts,
  types,
  categories,
  visibleColumns: initialVisibleColumns,
}: {
  transactions: TransactionRow[];
  hasFilters?: boolean;
  sortBy?: SortableColumn;
  sortDir?: SortDirection;
  page: number;
  pageSize: number;
  totalCount: number;
  accounts: LookupOption[];
  types: LookupOption[];
  categories: LookupOption[];
  visibleColumns: ColumnKey[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TransactionRow | null>(
    null
  );

  const requestEdit = useCallback(
    (id: number) => {
      if (editingId !== null && editingId !== id) {
        const ok = window.confirm(
          "Discard the changes you're currently editing?"
        );
        if (!ok) return;
      }
      setEditingId(id);
    },
    [editingId]
  );

  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    () => new Set(initialVisibleColumns)
  );

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      const encoded = encodeURIComponent(JSON.stringify([...next]));
      document.cookie = `${VISIBLE_COLUMNS_COOKIE}=${encoded}; path=/; max-age=${VISIBLE_COLUMNS_COOKIE_MAX_AGE}; samesite=lax`;
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
        <Table className="table-fixed">
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
              <TableHead className="w-[88px] text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((txn) => {
              const id = txn.transactionId;
              const isEditing = id !== null && editingId === id;
              const canEdit =
                id !== null &&
                txn.accountId !== null &&
                txn.transactionDate !== null &&
                txn.amount !== null &&
                txn.transactionTypeId !== null &&
                txn.transactionCategoryId !== null &&
                txn.transactionDescription !== null;

              if (isEditing && canEdit) {
                return (
                  <TransactionEditRow
                    key={id}
                    transactionId={id}
                    defaultDate={txn.transactionDate as string}
                    defaultDescription={txn.transactionDescription as string}
                    defaultAmount={txn.amount as string}
                    defaultAccountId={txn.accountId as number}
                    defaultRelatedAccountId={txn.relatedAccountId}
                    defaultTransactionTypeId={txn.transactionTypeId as number}
                    defaultTransactionCategoryId={
                      txn.transactionCategoryId as number
                    }
                    accounts={accounts}
                    types={types}
                    categories={categories}
                    columnSpan={filteredColumns.length + 1}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => setEditingId(null)}
                  />
                );
              }

              return (
                <TableRow key={id}>
                  {filteredColumns.map((col) => (
                    <TableCell key={col.key} className={col.cellClassName}>
                      {col.render(txn)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit transaction"
                        disabled={!canEdit}
                        onClick={() => id !== null && requestEdit(id)}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete transaction"
                        disabled={!canEdit}
                        onClick={() => setPendingDelete(txn)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {pendingDelete &&
        pendingDelete.transactionId !== null &&
        pendingDelete.transactionDate !== null &&
        pendingDelete.amount !== null &&
        pendingDelete.transactionDescription !== null && (
          <TransactionDeleteDialog
            open
            onOpenChange={(open) => {
              if (!open) setPendingDelete(null);
            }}
            transactionId={pendingDelete.transactionId}
            date={pendingDelete.transactionDate}
            description={pendingDelete.transactionDescription}
            amount={pendingDelete.amount}
          />
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
