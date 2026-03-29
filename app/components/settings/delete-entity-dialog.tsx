"use client";

import { useActionState, useEffect } from "react";
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
} from "@/components/ui/dialog";

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

const initialState: ActionState = { success: false, errors: {}, message: "" };

interface DeleteEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  itemId: number;
  itemIdFieldName: string;
  itemName: string;
  entityLabel: string;
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Deleting..." : "Delete"}
    </Button>
  );
}

export function DeleteEntityDialog({
  open,
  onOpenChange,
  action,
  itemId,
  itemIdFieldName,
  itemName,
  entityLabel,
}: DeleteEntityDialogProps) {
  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.message) {
      if (state.success) {
        toast.success(state.message);
        onOpenChange(false);
      } else {
        toast.error(state.message);
      }
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {entityLabel}</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{itemName}</strong>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <form action={formAction}>
            <input type="hidden" name={itemIdFieldName} value={itemId} />
            <DeleteButton />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
