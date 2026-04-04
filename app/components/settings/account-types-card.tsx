"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";

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
import type { AccountTypeRow } from "@/lib/queries/categories";

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

interface CategoryOption {
  id: number;
  name: string;
}

interface AccountTypesCardProps {
  accountTypes: AccountTypeRow[];
  categoryOptions: CategoryOption[];
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}

interface TypeGroup {
  categoryId: number;
  categoryName: string;
  types: AccountTypeRow[];
}

function groupByCategory(types: AccountTypeRow[]): TypeGroup[] {
  const map = new Map<number, TypeGroup>();
  for (const t of types) {
    if (!map.has(t.accountTypeCategoryId)) {
      map.set(t.accountTypeCategoryId, {
        categoryId: t.accountTypeCategoryId,
        categoryName: t.accountTypeCategory,
        types: [],
      });
    }
    map.get(t.accountTypeCategoryId)!.types.push(t);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName)
  );
}

interface EditTarget {
  id: number;
  name: string;
  categoryId: number;
}

export function AccountTypesCard({
  accountTypes,
  categoryOptions,
  createAction,
  updateAction,
  deleteAction,
}: AccountTypesCardProps) {
  const groups = groupByCategory(accountTypes);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [addDefaultCategoryId, setAddDefaultCategoryId] = useState<number | undefined>();
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  function toggleGroup(categoryId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function openAdd(categoryId?: number) {
    setAddDefaultCategoryId(categoryId);
    setAddOpen(true);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Account Types</CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add Account Type"
              onClick={() => openAdd()}
            >
              <Plus className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-y-auto max-h-[28rem] space-y-1">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No account types yet.
            </p>
          ) : (
            groups.map((group) => {
              const isCollapsed = collapsed.has(group.categoryId);
              return (
                <div key={group.categoryId}>
                  {/* Category header row */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.categoryId)}
                    className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="size-3.5 shrink-0" />
                    )}
                    {group.categoryName}
                  </button>

                  {!isCollapsed && (
                    <div className="ml-4 space-y-0.5">
                      {group.types.map((type) => (
                        <div
                          key={type.accountTypeId}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 group"
                        >
                          <span className="flex-1 min-w-0 truncate">
                            {type.accountType}
                          </span>
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Edit ${type.accountType}`}
                              onClick={() =>
                                setEditTarget({
                                  id: type.accountTypeId,
                                  name: type.accountType,
                                  categoryId: type.accountTypeCategoryId,
                                })
                              }
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Delete ${type.accountType}`}
                              onClick={() =>
                                setDeleteTarget({
                                  id: type.accountTypeId,
                                  name: type.accountType,
                                })
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-muted-foreground hover:text-foreground text-xs"
                        onClick={() => openAdd(group.categoryId)}
                      >
                        <Plus className="size-3.5 mr-1" />
                        Add type
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Add dialog — key changes when default category changes to reset state */}
      <EntityDialog
        key={`add-${addDefaultCategoryId ?? "none"}`}
        title="Add Account Type"
        open={addOpen}
        onOpenChange={setAddOpen}
        action={createAction}
        categoryOptions={categoryOptions}
        defaultCategoryId={addDefaultCategoryId}
      />

      {/* Edit dialog */}
      {editTarget && (
        <EntityDialog
          key={`edit-${editTarget.id}`}
          title="Edit Account Type"
          open={!!editTarget}
          onOpenChange={(open) => { if (!open) setEditTarget(null); }}
          action={updateAction}
          itemId={editTarget.id}
          itemIdFieldName="accountTypeId"
          defaultName={editTarget.name}
          categoryOptions={categoryOptions}
          defaultCategoryId={editTarget.categoryId}
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
          itemIdFieldName="accountTypeId"
          itemName={deleteTarget.name}
          entityLabel="Account Type"
        />
      )}
    </>
  );
}
