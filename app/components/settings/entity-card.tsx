"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { EntityDialog } from "@/components/settings/entity-dialog";
import { DeleteEntityDialog } from "@/components/settings/delete-entity-dialog";

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

interface EntityItem {
  id: number;
  name: string;
}

interface EntityCardProps {
  title: string;
  entityLabel: string;
  idFieldName: string;
  items: EntityItem[];
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}

export function EntityCard({
  title,
  entityLabel,
  idFieldName,
  items,
  createAction,
  updateAction,
  deleteAction,
}: EntityCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EntityItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EntityItem | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
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
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Add dialog */}
      <EntityDialog
        key="add"
        title={`Add ${entityLabel}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        action={createAction}
      />

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
