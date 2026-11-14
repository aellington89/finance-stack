"use client";

import { useId, useState } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
  // One per card, suffixed per row, so two cards on a page never share an id.
  const lockedReasonId = useId();

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
                  // discover by opening each row in turn. An outline Badge
                  // (Issue #358): muted text on a muted fill measured 4.34:1,
                  // under AA's 4.5:1. Normal weight, not the Badge's medium,
                  // so the role does not outweigh the category it describes.
                  <Badge variant="outline" className="font-normal">
                    {item.role.label}
                  </Badge>
                )}
                {item.lockedReason ? (
                  // The lock stays visible without hovering — it is the reason
                  // the row looks different, so hiding it until hover would be
                  // hiding the explanation.
                  //
                  // It is an enabled <button> (Issue #358), the trigger's
                  // default element, so Tab reaches it and focus opens the
                  // tooltip as hover does. It was a span, which only a mouse
                  // could open. It is not a disabled Button either, because
                  // buttonVariants sets disabled:pointer-events-none, which
                  // would stop the tooltip from ever opening. Base UI does not
                  // tie the tooltip's text to its trigger, so the reason is
                  // also the button's description, from a visually hidden copy,
                  // and a screen reader reads it on focus.
                  <>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        aria-label={`${item.name} is protected`}
                        aria-describedby={`${lockedReasonId}-${item.id}`}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Lock className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent side="left">{item.lockedReason}</TooltipContent>
                    </Tooltip>
                    <span id={`${lockedReasonId}-${item.id}`} className="sr-only">
                      {item.lockedReason}
                    </span>
                  </>
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
