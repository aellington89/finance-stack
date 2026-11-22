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
  ClearableComboboxField,
  ComboboxField,
  type LookupOption,
} from "@/components/transactions/combobox-fields";

import { submitTransaction } from "@/lib/actions/transaction";
import { getPostSubmitState } from "@/lib/forms/transaction";

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

export function TransactionForm({
  accounts,
  types,
  categories,
}: TransactionFormProps) {
  const [state, formAction] = useActionState(submitTransaction, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const handledStateRef = useRef(state);

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
    if (handledStateRef.current === state) return;
    handledStateRef.current = state;
    if (state.message) {
      if (state.success) {
        toast.success(state.message);
        formRef.current?.reset();
        const next = getPostSubmitState({
          transactionDate,
          amount,
          accountId,
          relatedAccountId,
          transactionTypeId,
          transactionCategoryId,
        });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resets controlled inputs after successful form submission
        setAmount(next.amount);
        setRelatedAccountId(next.relatedAccountId);
        setTransactionCategoryId(next.transactionCategoryId);
        // Date, Account, and Transaction Type intentionally retained.
      } else {
        toast.error(state.message);
      }
    }
  }, [state, transactionDate, amount, accountId, relatedAccountId, transactionTypeId, transactionCategoryId]);

  // The two-up rows below switch on the form's own width, not the viewport's
  // (Issue #145). From lg the Transactions page docks this form in a 380px
  // column — narrower than it is on a tablet — so `@md:` here is a container
  // query (28rem), not the 768px `md:` breakpoint it resembles. 28rem is the
  // narrowest form whose halves still fit the longest date DatePicker renders
  // ("September 22nd, 2026" needs a 204px button).
  return (
    <form ref={formRef} action={formAction} className="@container space-y-4">
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

      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
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
          <Label htmlFor="amount">Amount *</Label>
          <input type="hidden" name="amount" value={amount} />
          <CurrencyInput
            id="amount"
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

      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
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

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
