"use client";

import { useCallback, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { DeleteEntityDialog } from "@/components/settings/delete-entity-dialog";
import type { LookupOption } from "@/components/transactions/combobox-fields";
import { RecurringTransactionDialog } from "@/components/transactions/recurring-transaction-dialog";
import {
  STATUS_LABELS,
  recurringStatus,
  todayAsOf,
} from "@/components/transactions/recurring-schedule-view";
import { describeSchedule } from "@/lib/recurring/schedule";
import { formatCurrency } from "@/lib/format/financial";
import { formatLongDate } from "@/lib/format/dates";
import type { ActionState } from "@/lib/actions/utils";
import type { RecurringTransactionRow } from "@/lib/queries/recurring-transactions";

type Action = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

interface RecurringTransactionsCardProps {
  templates: RecurringTransactionRow[];
  accounts: LookupOption[];
  types: LookupOption[];
  categories: LookupOption[];
  /**
   * Postgres's CURRENT_DATE as the page read it (`getRecurringToday()`), so the
   * dialog's preview counts what the save will add, and the instant that date
   * ends, in epoch milliseconds.
   */
  today: string;
  todayEndsAt: number;
  createAction: Action;
  updateAction: Action;
  deleteAction: Action;
}

function scheduleOf(t: RecurringTransactionRow) {
  return { cadence: t.cadence, every: t.intervalCount, anchorDate: t.anchorDate, endDate: t.endDate };
}

/**
 * The Recurring tab (Issue #135): every recurring transaction, with add, edit
 * and delete in dialogs, the way the balance-transfer and settings cards
 * manage their rows. The actions are props, injected by the page.
 */
export function RecurringTransactionsCard({
  templates,
  accounts,
  types,
  categories,
  today,
  todayEndsAt,
  createAction,
  updateAction,
  deleteAction,
}: RecurringTransactionsCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RecurringTransactionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringTransactionRow | null>(null);
  // Read when a dialog opens, not at render, so a tab left open past the
  // database's midnight previews from the date the save will use.
  const [dialogToday, setDialogToday] = useState(today);
  const refreshToday = () => setDialogToday(todayAsOf(today, todayEndsAt));
  const openAdd = () => {
    refreshToday();
    setAddOpen(true);
  };
  const openEdit = (t: RecurringTransactionRow) => {
    refreshToday();
    setEditTarget(t);
  };
  // Stable, because the dialog's toast effect depends on it: a new function
  // on each render would toast the same result again.
  const closeEdit = useCallback((open: boolean) => {
    if (!open) setEditTarget(null);
  }, []);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Recurring transactions</CardTitle>
          <CardDescription>
            Rent, pay, subscriptions and bills. Each adds an ordinary
            transaction on its scheduled dates, checked hourly. A date missed
            while the app was down is added when it is back.
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="icon-xs" aria-label="Add recurring transaction" onClick={openAdd}>
              <Plus className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recurring transactions yet. Use + to add one: enter the details
              every transaction will carry, how often it repeats and its next
              date. Dates on or before today are added as soon as you save.
            </p>
          ) : (
            // w-0 + min-w-full: the table fills the card without adding to the
            // page's min-content width (the #417 fix for no-wrap cells
            // widening the whole page).
            <div className="w-0 min-w-full">
              <Table aria-label="Recurring transactions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Next</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => {
                    const status = recurringStatus(t);
                    const runs = status === "active" || status === "account-closed";
                    return (
                      <TableRow key={t.recurringTransactionId} data-testid={`recurring-${t.recurringTransactionId}`}>
                        {/* The two free-text columns wrap, as the balance-transfer
                            tracker's do, so a long name doesn't push the
                            next date, status and buttons out of the card. */}
                        <TableCell className="min-w-48 whitespace-normal font-medium">{t.transactionDescription}</TableCell>
                        <TableCell className="min-w-40 whitespace-normal">
                          {t.accountName}
                          {t.relatedAccountName && (
                            <span className="block text-xs text-muted-foreground">↔ {t.relatedAccountName}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(Number(t.amount))}</TableCell>
                        <TableCell>
                          {describeSchedule(scheduleOf(t))}
                          {t.endDate && (
                            <span className="block text-xs text-muted-foreground">until {formatLongDate(t.endDate)}</span>
                          )}
                        </TableCell>
                        <TableCell>{runs ? formatLongDate(t.nextRunDate) : "—"}</TableCell>
                        <TableCell>
                          {/* Outline, not the muted chip, whose grey-on-grey
                              measured 4.34:1 in axe (#417). */}
                          <Badge variant="outline">{STATUS_LABELS[status]}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Edit recurring transaction ${t.transactionDescription}`}
                              onClick={() => openEdit(t)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Delete recurring transaction ${t.transactionDescription}`}
                              onClick={() => setDeleteTarget(t)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mounted only while open, so each dialog starts from fresh state. */}
      {addOpen && (
        <RecurringTransactionDialog
          key="add"
          open={addOpen}
          onOpenChange={setAddOpen}
          action={createAction}
          accounts={accounts}
          types={types}
          categories={categories}
          today={dialogToday}
        />
      )}

      {editTarget && (
        <RecurringTransactionDialog
          key={`edit-${editTarget.recurringTransactionId}`}
          open={!!editTarget}
          onOpenChange={closeEdit}
          action={updateAction}
          accounts={accounts}
          types={types}
          categories={categories}
          template={editTarget}
          today={dialogToday}
        />
      )}

      {deleteTarget && (
        <DeleteEntityDialog
          key={`delete-${deleteTarget.recurringTransactionId}`}
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          action={deleteAction}
          itemId={deleteTarget.recurringTransactionId}
          itemIdFieldName="recurringTransactionId"
          itemName={deleteTarget.transactionDescription}
          entityLabel="recurring transaction"
          detail="Transactions it has already added are kept."
        />
      )}
    </>
  );
}
