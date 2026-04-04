"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
} from "@/components/ui/combobox";

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

const initialState: ActionState = { success: false, errors: {}, message: "" };

interface CategoryOption {
  id: number;
  name: string;
}

interface EntityDialogProps {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  /** Hidden ID field for edit mode */
  itemId?: number;
  itemIdFieldName?: string;
  /** Pre-filled name value */
  defaultName?: string;
  /** If provided, renders a category combobox (for Account Types) */
  categoryOptions?: CategoryOption[];
  defaultCategoryId?: number;
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : isEdit ? "Save Changes" : "Add"}
    </Button>
  );
}

export function EntityDialog({
  title,
  open,
  onOpenChange,
  action,
  itemId,
  itemIdFieldName,
  defaultName = "",
  categoryOptions,
  defaultCategoryId,
}: EntityDialogProps) {
  const isEdit = !!itemId;
  const [state, formAction] = useActionState(action, initialState);
  const [name, setName] = useState(defaultName);
  const [categoryId, setCategoryId] = useState(
    defaultCategoryId ? String(defaultCategoryId) : ""
  );

  // Sync controlled inputs when dialog opens or target item changes.
  // Intentional: resets form to fresh values each time the dialog opens for a (potentially different) item.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(defaultName);
      setCategoryId(defaultCategoryId ? String(defaultCategoryId) : "");
    }
  }, [open, defaultName, defaultCategoryId]);

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
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {itemId && itemIdFieldName && (
            <input type="hidden" name={itemIdFieldName} value={itemId} />
          )}

          <div className="space-y-2">
            <Label htmlFor="entity-name">Name *</Label>
            <Input
              id="entity-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name..."
              autoComplete="off"
              aria-invalid={state.errors.name ? true : undefined}
            />
            {state.errors.name && (
              <p className="text-sm text-destructive">{state.errors.name[0]}</p>
            )}
          </div>

          {categoryOptions && (
            <div className="space-y-2">
              <Label>Category *</Label>
              <input
                type="hidden"
                name="accountTypeCategoryId"
                value={categoryId}
              />
              <Combobox
                value={categoryId ? Number(categoryId) : null}
                onValueChange={(val) =>
                  setCategoryId(val != null ? String(val) : "")
                }
                items={categoryOptions.map((o) => o.id)}
                itemToStringLabel={(id: number) =>
                  categoryOptions.find((o) => o.id === id)?.name ?? String(id)
                }
              >
                <ComboboxInput
                  placeholder="Select category..."
                  className="w-full"
                  aria-invalid={
                    state.errors.accountTypeCategoryId ? true : undefined
                  }
                />
                <ComboboxContent>
                  <ComboboxList>
                    <ComboboxCollection>
                      {(id: number) => (
                        <ComboboxItem key={id} value={id}>
                          {categoryOptions.find((o) => o.id === id)?.name}
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                    <ComboboxEmpty>No results found</ComboboxEmpty>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {state.errors.accountTypeCategoryId && (
                <p className="text-sm text-destructive">
                  {state.errors.accountTypeCategoryId[0]}
                </p>
              )}
            </div>
          )}

          <DialogFooter showCloseButton>
            <SubmitButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
