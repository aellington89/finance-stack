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

/** A reporting role the user can tag a transaction category with (Issue #111). */
export interface RoleOption {
  key: string;
  label: string;
  description: string;
}

// The "no role" choice. Submitted as the empty string, which
// transactionCategorySchema normalises to null — clearing a role has to be
// possible, or a mis-tag would be permanent.
const NO_ROLE = "";

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
  /** If provided, renders the reporting-role picker (for Transaction Categories) */
  roleOptions?: RoleOption[];
  defaultRole?: string | null;
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
  roleOptions,
  defaultRole,
}: EntityDialogProps) {
  const isEdit = !!itemId;
  const [state, formAction] = useActionState(action, initialState);
  const [name, setName] = useState(defaultName);
  const [categoryId, setCategoryId] = useState(
    defaultCategoryId ? String(defaultCategoryId) : ""
  );
  const [role, setRole] = useState(defaultRole ?? NO_ROLE);

  // Sync controlled inputs when dialog opens or target item changes.
  // Intentional: resets form to fresh values each time the dialog opens for a (potentially different) item.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(defaultName);
      setCategoryId(defaultCategoryId ? String(defaultCategoryId) : "");
      setRole(defaultRole ?? NO_ROLE);
    }
  }, [open, defaultName, defaultCategoryId, defaultRole]);

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

          {roleOptions && (
            <div className="space-y-2">
              <Label htmlFor="entity-role">Reporting role</Label>
              {/*
                A native select rather than the Combobox used above: the list is
                four fixed options, not a searchable set, and each needs its
                explanation visible rather than behind a hover — "which of these
                is a HELOC principal payment" is the actual question being asked.
              */}
              <select
                id="entity-role"
                name="reportingRole"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-invalid={state.errors.reportingRole ? true : undefined}
                className="border-input bg-transparent dark:bg-input/30 flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive"
              >
                <option value={NO_ROLE}>None — not used by any report</option>
                {roleOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {roleOptions.find((o) => o.key === role)?.description ??
                  "Categories with a role feed the matching totals on the Liabilities tab. Leave this as None unless you want it counted there."}
              </p>
              {state.errors.reportingRole && (
                <p className="text-sm text-destructive">
                  {state.errors.reportingRole[0]}
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
