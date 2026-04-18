"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { CheckIcon, XIcon } from "lucide-react";

import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
} from "@/components/ui/combobox";

import { updateTransaction } from "@/lib/actions/transaction";

interface LookupOption {
  id: number;
  name: string;
}

interface ActionState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

const initialState: ActionState = { success: false, errors: {}, message: "" };

interface TransactionEditRowProps {
  transactionId: number;
  defaultDate: string;
  defaultDescription: string;
  defaultAmount: string;
  defaultAccountId: number;
  defaultRelatedAccountId: number | null;
  defaultTransactionTypeId: number;
  defaultTransactionCategoryId: number;
  accounts: LookupOption[];
  types: LookupOption[];
  categories: LookupOption[];
  columnSpan: number;
  onCancel: () => void;
  onSaved: () => void;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <CheckIcon className="size-4" />
      {pending ? "Saving..." : "Save"}
    </Button>
  );
}

function ComboField({
  label,
  name,
  options,
  value,
  onChange,
  placeholder,
  showClear = false,
  invalid = false,
}: {
  label: string;
  name: string;
  options: LookupOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showClear?: boolean;
  invalid?: boolean;
}) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Combobox
        value={value ? Number(value) : null}
        onValueChange={(val) => onChange(val != null ? String(val) : "")}
        items={options.map((o) => o.id)}
        itemToStringLabel={(id: number) =>
          options.find((o) => o.id === id)?.name ?? String(id)
        }
      >
        <ComboboxInput
          placeholder={placeholder ?? `Select ${label.toLowerCase()}...`}
          showClear={showClear && !!value}
          className="w-full"
          aria-invalid={invalid ? true : undefined}
        />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxCollection>
              {(itemId: number) => (
                <ComboboxItem key={itemId} value={itemId}>
                  {options.find((o) => o.id === itemId)?.name}
                </ComboboxItem>
              )}
            </ComboboxCollection>
            <ComboboxEmpty>No results found</ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>
  );
}

export function TransactionEditRow({
  transactionId,
  defaultDate,
  defaultDescription,
  defaultAmount,
  defaultAccountId,
  defaultRelatedAccountId,
  defaultTransactionTypeId,
  defaultTransactionCategoryId,
  accounts,
  types,
  categories,
  columnSpan,
  onCancel,
  onSaved,
}: TransactionEditRowProps) {
  const [state, formAction] = useActionState(updateTransaction, initialState);
  const handledStateRef = useRef(state);

  // Initialised once from the row's current values; never re-synced — closing
  // the row (Cancel/Save) unmounts this component, so a new edit starts fresh.
  const [transactionDate, setTransactionDate] = useState(defaultDate);
  const [amount, setAmount] = useState(defaultAmount);
  const [accountId, setAccountId] = useState(String(defaultAccountId));
  const [relatedAccountId, setRelatedAccountId] = useState(
    defaultRelatedAccountId !== null ? String(defaultRelatedAccountId) : ""
  );
  const [transactionTypeId, setTransactionTypeId] = useState(
    String(defaultTransactionTypeId)
  );
  const [transactionCategoryId, setTransactionCategoryId] = useState(
    String(defaultTransactionCategoryId)
  );

  useEffect(() => {
    if (handledStateRef.current === state) return;
    handledStateRef.current = state;
    if (!state.message) return;
    if (state.success) {
      toast.success(state.message);
      onSaved();
    } else {
      toast.error(state.message);
    }
  }, [state, onSaved]);

  return (
    <TableRow className="bg-muted/30">
      <TableCell colSpan={columnSpan} className="p-3">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="transactionId" value={transactionId} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date *</Label>
              <input
                type="hidden"
                name="transactionDate"
                value={transactionDate}
              />
              <DatePicker
                value={transactionDate}
                onChange={setTransactionDate}
                placeholder="Pick a date"
              />
              {state.errors.transactionDate && (
                <p className="text-xs text-destructive">
                  {state.errors.transactionDate[0]}
                </p>
              )}
            </div>

            <div className="space-y-1 sm:col-span-2 lg:col-span-2">
              <Label
                htmlFor={`edit-desc-${transactionId}`}
                className="text-xs text-muted-foreground"
              >
                Description *
              </Label>
              <Input
                id={`edit-desc-${transactionId}`}
                name="transactionDescription"
                defaultValue={defaultDescription}
                autoComplete="off"
                aria-invalid={
                  state.errors.transactionDescription ? true : undefined
                }
              />
              {state.errors.transactionDescription && (
                <p className="text-xs text-destructive">
                  {state.errors.transactionDescription[0]}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Amount *</Label>
              <input type="hidden" name="amount" value={amount} />
              <CurrencyInput
                value={amount}
                onChange={setAmount}
                aria-invalid={state.errors.amount ? true : undefined}
              />
              {state.errors.amount && (
                <p className="text-xs text-destructive">
                  {state.errors.amount[0]}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Account *</Label>
              <ComboField
                label="Account"
                name="accountId"
                options={accounts}
                value={accountId}
                onChange={setAccountId}
                invalid={!!state.errors.accountId}
              />
              {state.errors.accountId && (
                <p className="text-xs text-destructive">
                  {state.errors.accountId[0]}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Related Account
              </Label>
              <ComboField
                label="Related Account"
                name="relatedAccountId"
                options={accounts}
                value={relatedAccountId}
                onChange={setRelatedAccountId}
                placeholder="Select related account (optional)..."
                showClear
                invalid={!!state.errors.relatedAccountId}
              />
              {state.errors.relatedAccountId && (
                <p className="text-xs text-destructive">
                  {state.errors.relatedAccountId[0]}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type *</Label>
              <ComboField
                label="Type"
                name="transactionTypeId"
                options={types}
                value={transactionTypeId}
                onChange={setTransactionTypeId}
                invalid={!!state.errors.transactionTypeId}
              />
              {state.errors.transactionTypeId && (
                <p className="text-xs text-destructive">
                  {state.errors.transactionTypeId[0]}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Category *</Label>
              <ComboField
                label="Category"
                name="transactionCategoryId"
                options={categories}
                value={transactionCategoryId}
                onChange={setTransactionCategoryId}
                invalid={!!state.errors.transactionCategoryId}
              />
              {state.errors.transactionCategoryId && (
                <p className="text-xs text-destructive">
                  {state.errors.transactionCategoryId[0]}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              <XIcon className="size-4" />
              Cancel
            </Button>
            <SaveButton />
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}
