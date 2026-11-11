"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import type { ActionState } from "@/lib/actions/utils";
import type {
  AccountBalanceTransfer,
  BalanceTransferCandidate,
} from "@/lib/queries/balance-transfers";
import {
  candidateLabel,
  feeOptions,
  postingOptions,
} from "@/components/accounts/balance-transfer-candidates";

const initialState: ActionState = { success: false, errors: {}, message: "" };

// The fee picker's "No separate fee" entry. Transaction ids are positive, so 0
// can't collide with one. It is submitted as the empty string.
const NO_FEE = 0;

interface BalanceTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  accountId: number;
  candidates: readonly BalanceTransferCandidate[];
  /** The transfer being edited. Absent when adding one. */
  transfer?: AccountBalanceTransfer;
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : isEdit ? "Save Changes" : "Add"}
    </Button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-sm text-destructive">{errors[0]}</p>;
}

/**
 * Add or edit one balance transfer (Issue #417). Both transactions are picked
 * from the ledger, not typed. Only the promo's end date and APR are entered.
 * A transfer that happened in the past is recorded the same way, by picking
 * the posting and fee that are already there.
 */
export function BalanceTransferDialog({
  open,
  onOpenChange,
  action,
  accountId,
  candidates,
  transfer,
}: BalanceTransferDialogProps) {
  const isEdit = transfer !== undefined;
  const editingId = transfer?.balanceTransferId ?? null;
  const [state, formAction] = useActionState(action, initialState);

  const [postingId, setPostingId] = useState<number | null>(
    transfer?.transferTransactionId ?? null
  );
  const [feeId, setFeeId] = useState<number>(
    transfer?.feeTransactionId ?? NO_FEE
  );
  const [promoEndDate, setPromoEndDate] = useState(transfer?.promoEndDate ?? "");
  const [promoApr, setPromoApr] = useState(
    transfer ? String(transfer.promoApr) : "0"
  );

  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.transactionId, c])),
    [candidates]
  );
  const postings = useMemo(
    () => postingOptions(candidates, editingId),
    [candidates, editingId]
  );
  const fees = useMemo(
    () => feeOptions(candidates, postingId, editingId),
    [candidates, postingId, editingId]
  );

  const labelFor = (id: number) => {
    if (id === NO_FEE) return "No separate fee";
    const c = byId.get(id);
    return c ? candidateLabel(c) : String(id);
  };

  const pickPosting = (id: number | null) => {
    setPostingId(id);
    // A fee dated before the new posting is no longer on offer.
    const next = feeOptions(candidates, id, editingId);
    if (feeId !== NO_FEE && !next.some((c) => c.transactionId === feeId)) {
      setFeeId(NO_FEE);
    }
  };

  useEffect(() => {
    if (!state.message) return;
    if (state.success) {
      toast.success(state.message);
      onOpenChange(false);
    } else {
      toast.error(state.message);
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit balance transfer" : "Add balance transfer"}</DialogTitle>
          <DialogDescription>
            Pick the transfer as it posted to this card, and its fee if one
            posted separately. Then enter the promo&apos;s end date and APR.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="accountId" value={accountId} />
          {transfer && (
            <input
              type="hidden"
              name="balanceTransferId"
              value={transfer.balanceTransferId}
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="bt-posting">Transfer posting *</Label>
            <input
              type="hidden"
              name="transferTransactionId"
              value={postingId ?? ""}
            />
            <Combobox
              value={postingId}
              onValueChange={(val) => pickPosting(val ?? null)}
              items={postings.map((c) => c.transactionId)}
              itemToStringLabel={labelFor}
            >
              <ComboboxInput
                id="bt-posting"
                placeholder="Search this card's transactions..."
                className="w-full"
                aria-invalid={state.errors.transferTransactionId ? true : undefined}
              />
              <ComboboxContent>
                <ComboboxList>
                  <ComboboxCollection>
                    {(id: number) => (
                      <ComboboxItem key={id} value={id}>
                        {labelFor(id)}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  <ComboboxEmpty>No matching transactions</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <p className="text-xs text-muted-foreground">
              Transfers are listed first, newest first.
            </p>
            <FieldError errors={state.errors.transferTransactionId} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bt-fee">Fee</Label>
            <input
              type="hidden"
              name="feeTransactionId"
              value={feeId === NO_FEE ? "" : feeId}
            />
            <Combobox
              value={feeId}
              onValueChange={(val) => setFeeId(val ?? NO_FEE)}
              items={[NO_FEE, ...fees.map((c) => c.transactionId)]}
              itemToStringLabel={labelFor}
              disabled={postingId === null}
            >
              <ComboboxInput
                id="bt-fee"
                placeholder={
                  postingId === null ? "Pick the posting first" : "Search..."
                }
                className="w-full"
                aria-invalid={state.errors.feeTransactionId ? true : undefined}
              />
              <ComboboxContent>
                <ComboboxList>
                  <ComboboxCollection>
                    {(id: number) => (
                      <ComboboxItem key={id} value={id}>
                        {labelFor(id)}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  <ComboboxEmpty>No matching transactions</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <p className="text-xs text-muted-foreground">
              Transactions on or after the posting date, nearest first. Pick
              &ldquo;No separate fee&rdquo; if the issuer folded it into the
              transfer.
            </p>
            <FieldError errors={state.errors.feeTransactionId} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bt-end-date">Promo end date *</Label>
              <Input
                id="bt-end-date"
                name="promoEndDate"
                type="date"
                value={promoEndDate}
                onChange={(e) => setPromoEndDate(e.target.value)}
                aria-invalid={state.errors.promoEndDate ? true : undefined}
              />
              <FieldError errors={state.errors.promoEndDate} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-apr">Promo APR (%) *</Label>
              <Input
                id="bt-apr"
                name="promoApr"
                inputMode="decimal"
                value={promoApr}
                onChange={(e) => setPromoApr(e.target.value)}
                autoComplete="off"
                aria-invalid={state.errors.promoApr ? true : undefined}
              />
              <FieldError errors={state.errors.promoApr} />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <SubmitButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
