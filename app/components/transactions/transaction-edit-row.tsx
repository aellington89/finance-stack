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

import {
  updateTransaction,
  duplicateTransaction,
} from "@/lib/actions/transaction";

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

/**
 * `edit` saves over the row (updateTransaction). `duplicate` saves the same
 * fields as a new transaction linked back to this one (duplicateTransaction,
 * Issue #241) and leaves the row itself alone. Required rather than defaulted,
 * so no call site can end up in the wrong mode by omission.
 */
export type TransactionRowMode = "edit" | "duplicate";

interface TransactionEditRowProps {
  mode: TransactionRowMode;
  /** The row being edited, or the source being duplicated. */
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

function SaveButton({ mode }: { mode: TransactionRowMode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <CheckIcon className="size-4" />
      {pending ? "Saving..." : mode === "duplicate" ? "Save copy" : "Save"}
    </Button>
  );
}

/**
 * A copy is a new transaction, and the New Transaction form only offers open
 * accounts — so a duplicate drops a source account that is no longer among
 * the options (it closed) rather than carrying it over. Left in, the combobox
 * would show the bare id and the copy would post to a closed account.
 */
function initialAccountValue(
  mode: TransactionRowMode,
  id: number | null,
  accounts: LookupOption[]
): string {
  if (id === null) return "";
  if (mode === "duplicate" && !accounts.some((a) => a.id === id)) return "";
  return String(id);
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
  mode,
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
  // `mode` is fixed for the life of the row: TransactionList keys edit and
  // duplicate rows apart, so switching modes mounts a new one.
  const [state, formAction] = useActionState(
    mode === "duplicate" ? duplicateTransaction : updateTransaction,
    initialState
  );
  const handledStateRef = useRef(state);

  // Initialised once from the row's current values; never re-synced — closing
  // the row (Cancel/Save) unmounts this component, so a new edit starts fresh.
  // A duplicate starts from the same values, date included: the issue asks for
  // the form "prefilled with the source transaction's data".
  const [transactionDate, setTransactionDate] = useState(defaultDate);
  const [amount, setAmount] = useState(defaultAmount);
  const [accountId, setAccountId] = useState(() =>
    initialAccountValue(mode, defaultAccountId, accounts)
  );
  const [relatedAccountId, setRelatedAccountId] = useState(() =>
    initialAccountValue(mode, defaultRelatedAccountId, accounts)
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
        <form
          action={formAction}
          aria-label={
            mode === "duplicate" ? "Duplicate transaction" : "Edit transaction"
          }
          className="space-y-3"
        >
          <input
            type="hidden"
            name={mode === "duplicate" ? "sourceTransactionId" : "transactionId"}
            value={transactionId}
          />

          {mode === "duplicate" && (
            <p className="text-xs text-muted-foreground">
              Duplicate: saves as a new transaction; the original is unchanged.
            </p>
          )}

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
                htmlFor={`${mode}-desc-${transactionId}`}
                className="text-xs text-muted-foreground"
              >
                Description *
              </Label>
              <Input
                id={`${mode}-desc-${transactionId}`}
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
            <SaveButton mode={mode} />
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}
