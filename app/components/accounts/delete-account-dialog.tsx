"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import { deleteAccount } from "@/lib/actions/account";

interface DeleteAccountDialogProps {
  accountId: number;
  accountName: string;
}

const initialState = {
  success: false,
  errors: {} as Record<string, string[]>,
  message: "",
};

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Deleting..." : "Delete Account"}
    </Button>
  );
}

export function DeleteAccountDialog({
  accountId,
  accountName,
}: DeleteAccountDialogProps) {
  const [state, formAction] = useActionState(deleteAccount, initialState);

  useEffect(() => {
    if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="destructive" size="sm" />}
      >
        Delete Account
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Account</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{accountName}</strong>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <form action={formAction}>
            <input type="hidden" name="accountId" value={accountId} />
            <DeleteButton />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
