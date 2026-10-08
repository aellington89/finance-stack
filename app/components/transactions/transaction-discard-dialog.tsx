"use client";

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

interface TransactionDiscardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}

// Asked when Edit is clicked on one row while another is open for editing
// (Issue #148, replacing the browser's confirm box). The way back is "Keep
// editing" rather than the delete dialogs' "Cancel": in a discard prompt,
// "Cancel" reads as "cancel the edit", which is the opposite of what it does.
export function TransactionDiscardDialog({
  open,
  onOpenChange,
  onDiscard,
}: TransactionDiscardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>
            You are already editing a transaction. Editing a different one
            discards your unsaved changes.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Keep editing
          </DialogClose>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
