"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

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

import { submitTransaction } from "./actions";

interface TransactionFormState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

const initialFormState: TransactionFormState = {
  success: false,
  errors: {},
  message: "",
};

interface LookupOption {
  id: number;
  name: string;
}

interface TransactionFormProps {
  accounts: LookupOption[];
  types: LookupOption[];
  categories: LookupOption[];
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Submitting..." : "Submit"}
    </Button>
  );
}

function ComboboxField({
  label,
  name,
  options,
  value,
  onChange,
  required = false,
  error,
}: {
  label: string;
  name: string;
  options: LookupOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string[];
}) {
  const selectedOption = options.find((o) => String(o.id) === value);

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}{required && " *"}</Label>
      <input type="hidden" name={name} value={value} />
      <Combobox
        value={value ? Number(value) : null}
        onValueChange={(val) => {
          onChange(val != null ? String(val) : "");
        }}
        items={options.map((o) => o.id)}
        itemToStringLabel={(id: number) => {
          return options.find((o) => o.id === id)?.name ?? String(id);
        }}
      >
        <ComboboxInput
          placeholder={`Select ${label.toLowerCase()}...`}
          className="w-full"
          aria-invalid={error ? true : undefined}
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
      {error && (
        <p className="text-sm text-destructive">{error[0]}</p>
      )}
    </div>
  );
}

function ClearableComboboxField({
  label,
  name,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  name: string;
  options: LookupOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <Combobox
        value={value ? Number(value) : null}
        onValueChange={(val) => {
          onChange(val != null ? String(val) : "");
        }}
        items={options.map((o) => o.id)}
        itemToStringLabel={(id: number) => {
          return options.find((o) => o.id === id)?.name ?? String(id);
        }}
      >
        <ComboboxInput
          placeholder={`Select ${label.toLowerCase()} (optional)...`}
          showClear={!!value}
          className="w-full"
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
      {error && (
        <p className="text-sm text-destructive">{error[0]}</p>
      )}
    </div>
  );
}

export function TransactionForm({
  accounts,
  types,
  categories,
}: TransactionFormProps) {
  const [state, formAction] = useActionState(submitTransaction, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);

  // Controlled state for custom components (not native inputs)
  const [transactionDate, setTransactionDate] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [relatedAccountId, setRelatedAccountId] = useState("");
  const [transactionTypeId, setTransactionTypeId] = useState("");
  const [transactionCategoryId, setTransactionCategoryId] = useState("");

  useEffect(() => {
    if (state.message) {
      if (state.success) {
        toast.success(state.message);
        formRef.current?.reset();
        setAmount("");
        setAccountId("");
        setRelatedAccountId("");
        setTransactionTypeId("");
        setTransactionCategoryId("");
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        setTransactionDate(`${yyyy}-${mm}-${dd}`);
      } else {
        toast.error(state.message);
      }
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="mt-6 space-y-6">
      {/* Row 1: Description, Date, Amount */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto]">
        <div className="space-y-2">
          <Label htmlFor="transactionDescription">Description *</Label>
          <Input
            id="transactionDescription"
            name="transactionDescription"
            placeholder="e.g. Grocery Store"
            autoComplete="off"
            required
            aria-invalid={state.errors.transactionDescription ? true : undefined}
          />
          {state.errors.transactionDescription && (
            <p className="text-sm text-destructive">
              {state.errors.transactionDescription[0]}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Date *</Label>
          <input type="hidden" name="transactionDate" value={transactionDate} />
          <DatePicker
            value={transactionDate}
            onChange={setTransactionDate}
            placeholder="Pick a date"
          />
          {state.errors.transactionDate && (
            <p className="text-sm text-destructive">
              {state.errors.transactionDate[0]}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Amount *</Label>
          <input type="hidden" name="amount" value={amount} />
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            autoComplete="off"
            aria-invalid={state.errors.amount ? true : undefined}
          />
          {state.errors.amount && (
            <p className="text-sm text-destructive">
              {state.errors.amount[0]}
            </p>
          )}
        </div>
      </div>

      {/* Row 2: Account, Related Account */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ComboboxField
          label="Account"
          name="accountId"
          options={accounts}
          value={accountId}
          onChange={setAccountId}
          required
          error={state.errors.accountId}
        />

        <ClearableComboboxField
          label="Related Account"
          name="relatedAccountId"
          options={accounts}
          value={relatedAccountId}
          onChange={setRelatedAccountId}
          error={state.errors.relatedAccountId}
        />
      </div>

      {/* Row 3: Transaction Type, Category */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ComboboxField
          label="Transaction Type"
          name="transactionTypeId"
          options={types}
          value={transactionTypeId}
          onChange={setTransactionTypeId}
          required
          error={state.errors.transactionTypeId}
        />

        <ComboboxField
          label="Category"
          name="transactionCategoryId"
          options={categories}
          value={transactionCategoryId}
          onChange={setTransactionCategoryId}
          required
          error={state.errors.transactionCategoryId}
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
