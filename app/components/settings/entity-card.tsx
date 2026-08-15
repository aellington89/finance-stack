"use client";

import { useState } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EntityDialog, type RoleOption } from "@/components/settings/entity-dialog";
import { DeleteEntityDialog } from "@/components/settings/delete-entity-dialog";

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

interface EntityItem {
  id: number;
  name: string;
  // Set when the row is protected (Issue #109) — the hover text explaining why.
  // The server action refuses these regardless; this only removes the
  // affordance that would lead the user into that refusal.
  lockedReason?: string | null;
  // The row's reporting role, for tables that carry one (Issue #111). `label`
  // is what the row renders; `key` is what the edit dialog pre-selects.
  role?: { key: string; label: string } | null;
}

interface EntityCardProps {
  title: string;
  entityLabel: string;
  idFieldName: string;
  items: EntityItem[];
  // Omitted where the table does not accept user-created rows — Transaction
  // Types, whose full set ships with the app (Issue #109). Leaving it out
  // hides the Add button and the add dialog entirely.
  createAction?: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  // Passed only for Transaction Categories, which is the one lookup table
  // carrying a reporting role (Issue #111). Its presence is what renders the
  // picker in the add/edit dialogs.
  roleOptions?: RoleOption[];
}

export function EntityCard({
  title,
  entityLabel,
  idFieldName,
  items,
  createAction,
  updateAction,
  deleteAction,
  roleOptions,
}: EntityCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EntityItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EntityItem | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {createAction && (
            <CardAction>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Add ${entityLabel}`}
                onClick={() => setAddOpen(true)}
              >
                <Plus className="size-4" />
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="overflow-y-auto max-h-[28rem] space-y-0.5">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No {title.toLowerCase()} yet.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 group"
              >
                <span className="flex-1 min-w-0 truncate">{item.name}</span>
                {item.role && (
                  // Visible without hovering, like the lock: a role changes what
                  // the row does to the Liabilities totals, so it is the kind of
                  // thing you want to see while scanning the list rather than
                  // discover by opening each row in turn.
                  <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {item.role.label}
                  </span>
                )}
                {item.lockedReason ? (
                  // The lock stays visible without hovering — it is the reason
                  // the row looks different, so hiding it until hover would be
                  // hiding the explanation. It is a plain span rather than a
                  // disabled Button because buttonVariants sets
                  // disabled:pointer-events-none, which would stop the tooltip
                  // from ever opening.
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
                          aria-label={`${item.name} is protected`}
                        />
                      }
                    >
                      <Lock className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="left">{item.lockedReason}</TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${item.name}`}
                      onClick={() => setEditTarget(item)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${item.name}`}
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Add dialog — absent for tables that take no user-created rows */}
      {createAction && (
        <EntityDialog
          key="add"
          title={`Add ${entityLabel}`}
          open={addOpen}
          onOpenChange={setAddOpen}
          action={createAction}
          roleOptions={roleOptions}
        />
      )}

      {/* Edit dialog — remounts per item via key */}
      {editTarget && (
        <EntityDialog
          key={`edit-${editTarget.id}`}
          title={`Edit ${entityLabel}`}
          open={!!editTarget}
          onOpenChange={(open) => { if (!open) setEditTarget(null); }}
          action={updateAction}
          itemId={editTarget.id}
          itemIdFieldName={idFieldName}
          defaultName={editTarget.name}
          roleOptions={roleOptions}
          defaultRole={editTarget.role?.key ?? null}
        />
      )}

      {/* Delete dialog */}
      {deleteTarget && (
        <DeleteEntityDialog
          key={`delete-${deleteTarget.id}`}
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          action={deleteAction}
          itemId={deleteTarget.id}
          itemIdFieldName={idFieldName}
          itemName={deleteTarget.name}
          entityLabel={entityLabel}
        />
      )}
    </>
  );
}
