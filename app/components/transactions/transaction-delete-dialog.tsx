"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

import { deleteTransaction } from "@/lib/actions/transaction";

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

const initialState: ActionState = { success: false, errors: {}, message: "" };

interface TransactionDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: number;
  date: string;
  description: string;
  amount: string;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${month}/${day}/${year}`;
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Deleting..." : "Delete Transaction"}
    </Button>
  );
}

export function TransactionDeleteDialog({
  open,
  onOpenChange,
  transactionId,
  date,
  description,
  amount,
}: TransactionDeleteDialogProps) {
  const [state, formAction] = useActionState(deleteTransaction, initialState);
  const handledStateRef = useRef(state);

  useEffect(() => {
    if (handledStateRef.current === state) return;
    handledStateRef.current = state;
    if (!state.message) return;
    if (state.success) {
      toast.success(state.message);
      onOpenChange(false);
    } else {
      toast.error(state.message);
    }
  }, [state, onOpenChange]);

  const amountNumber = Number(amount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Transaction</DialogTitle>
          <DialogDescription>
            This action cannot be undone. The affected account balance history
            will be rebuilt automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/50 p-3 text-sm">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Date</span>
            <span className="font-medium">{formatDate(date)}</span>
            <span className="text-muted-foreground">Description</span>
            <span className="font-medium">{description}</span>
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">
              {currencyFormatter.format(amountNumber)}
            </span>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <form action={formAction}>
            <input type="hidden" name="transactionId" value={transactionId} />
            <DeleteButton />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
