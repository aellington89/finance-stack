"use client";

import { useState } from "react";
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
import { BalanceTransferDialog } from "@/components/accounts/balance-transfer-dialog";
import { DeleteEntityDialog } from "@/components/settings/delete-entity-dialog";
import type { ActionState } from "@/lib/actions/utils";
import type {
  AccountBalanceTransfer,
  BalanceTransferCandidate,
} from "@/lib/queries/balance-transfers";
import { formatApr, formatCurrency } from "@/lib/format/financial";
import { formatLongDate } from "@/lib/format/dates";

type Action = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

interface BalanceTransfersCardProps {
  accountId: number;
  transfers: AccountBalanceTransfer[];
  candidates: BalanceTransferCandidate[];
  createAction: Action;
  updateAction: Action;
  deleteAction: Action;
}

/** "$6,000.00 from Visa", the transfer as a person would name it. */
export function transferName(t: AccountBalanceTransfer): string {
  return `${formatCurrency(Math.abs(t.postingAmount))} from ${t.sourceAccountName ?? "External"}`;
}

/**
 * The account edit page's Balance transfers section (Issue #417), shown on
 * liability accounts only. It lists the account's transfers, active ones
 * first, and adds, edits and removes them in dialogs, the way the settings
 * cards manage their rows.
 */
export function BalanceTransfersCard({
  accountId,
  transfers,
  candidates,
  createAction,
  updateAction,
  deleteAction,
}: BalanceTransfersCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountBalanceTransfer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountBalanceTransfer | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Balance transfers</CardTitle>
          <CardDescription>
            Record a promotional rate on this card by linking the transfer as it
            posted, and its fee. While a promo is active, the Liabilities page
            tracks its payoff, and the card&apos;s whole balance counts as
            promotional.
          </CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add balance transfer"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No balance transfers recorded. Use + to link one: pick the
              transfer&apos;s posting and fee from this card&apos;s
              transactions, then enter the promo&apos;s end date and APR.
            </p>
          ) : (
            <ul className="divide-y" aria-label="Balance transfers">
              {transfers.map((t) => (
                <li
                  key={t.balanceTransferId}
                  data-testid={`balance-transfer-${t.balanceTransferId}`}
                  className="flex items-start gap-2 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{transferName(t)}</span>
                      {/* Outline rather than the settings cards' muted chip,
                          whose grey-on-grey measures 4.34:1 in axe. */}
                      <Badge variant="outline">{t.isActive ? "Active" : "Ended"}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatApr(t.promoApr)} until {formatLongDate(t.promoEndDate)}
                      {" · "}posted {formatLongDate(t.postingDate)}
                      {" · "}
                      {t.feeAmount === null
                        ? "no fee linked"
                        : `fee ${formatCurrency(Math.abs(t.feeAmount))}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit balance transfer of ${transferName(t)}`}
                      onClick={() => setEditTarget(t)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete balance transfer of ${transferName(t)}`}
                      onClick={() => setDeleteTarget(t)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Mounted only while open, so each add starts from an empty form. */}
      {addOpen && (
        <BalanceTransferDialog
          key="add"
          open={addOpen}
          onOpenChange={setAddOpen}
          action={createAction}
          accountId={accountId}
          candidates={candidates}
        />
      )}

      {editTarget && (
        <BalanceTransferDialog
          key={`edit-${editTarget.balanceTransferId}`}
          open={!!editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          action={updateAction}
          accountId={accountId}
          candidates={candidates}
          transfer={editTarget}
        />
      )}

      {deleteTarget && (
        <DeleteEntityDialog
          key={`delete-${deleteTarget.balanceTransferId}`}
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          action={deleteAction}
          itemId={deleteTarget.balanceTransferId}
          itemIdFieldName="balanceTransferId"
          itemName={transferName(deleteTarget)}
          entityLabel="balance transfer"
          detail="Its posting and fee stay in the ledger; only the promo terms are removed."
        />
      )}
    </>
  );
}
