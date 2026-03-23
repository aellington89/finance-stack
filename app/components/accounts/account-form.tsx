"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
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

import { createAccount, updateAccount } from "@/lib/actions/account";

interface FormState {
  success: boolean;
  errors: Record<string, string[]>;
  message: string;
}

const initialFormState: FormState = {
  success: false,
  errors: {},
  message: "",
};

interface LookupOption {
  id: number;
  name: string;
}

interface AccountData {
  accountId: number;
  accountName: string;
  accountTypeId: number;
  accountIdentifier: string | null;
  openedDate: string | null;
  closedDate: string | null;
}

interface AccountFormProps {
  accountTypes: LookupOption[];
  account?: AccountData;
  defaultTypeId?: number;
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? isEdit
          ? "Saving..."
          : "Creating..."
        : isEdit
          ? "Save Changes"
          : "Create Account"}
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
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
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
      {error && <p className="text-sm text-destructive">{error[0]}</p>}
    </div>
  );
}

export function AccountForm({ accountTypes, account, defaultTypeId }: AccountFormProps) {
  const isEdit = !!account;
  const router = useRouter();

  const action = isEdit ? updateAccount : createAccount;
  const [state, formAction] = useActionState(action, initialFormState);

  const [accountTypeId, setAccountTypeId] = useState(
    account
      ? String(account.accountTypeId)
      : defaultTypeId
        ? String(defaultTypeId)
        : ""
  );
  const [openedDate, setOpenedDate] = useState(account?.openedDate ?? "");
  const [closedDate, setClosedDate] = useState(account?.closedDate ?? "");
  const [initialBalance, setInitialBalance] = useState("");

  useEffect(() => {
    if (state.message) {
      if (state.success) {
        toast.success(state.message);
        router.push("/accounts");
      } else {
        toast.error(state.message);
      }
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      {isEdit && (
        <input type="hidden" name="accountId" value={account.accountId} />
      )}

      <div className="space-y-2">
        <Label htmlFor="accountName">Account Name *</Label>
        <Input
          id="accountName"
          name="accountName"
          defaultValue={account?.accountName ?? ""}
          placeholder="e.g. Chase Checking"
          autoComplete="off"
          required
          aria-invalid={state.errors.accountName ? true : undefined}
        />
        {state.errors.accountName && (
          <p className="text-sm text-destructive">
            {state.errors.accountName[0]}
          </p>
        )}
      </div>

      <ComboboxField
        label="Account Type"
        name="accountTypeId"
        options={accountTypes}
        value={accountTypeId}
        onChange={setAccountTypeId}
        required
        error={state.errors.accountTypeId}
      />

      <div className="space-y-2">
        <Label htmlFor="accountIdentifier">Account Identifier</Label>
        <Input
          id="accountIdentifier"
          name="accountIdentifier"
          defaultValue={account?.accountIdentifier ?? ""}
          placeholder="e.g. last 4 digits"
          autoComplete="off"
          aria-invalid={state.errors.accountIdentifier ? true : undefined}
        />
        {state.errors.accountIdentifier && (
          <p className="text-sm text-destructive">
            {state.errors.accountIdentifier[0]}
          </p>
        )}
      </div>

      <div className={isEdit ? "grid grid-cols-2 gap-4" : ""}>
        <div className="space-y-2">
          <Label>Opened Date</Label>
          <input type="hidden" name="openedDate" value={openedDate} />
          <DatePicker
            value={openedDate}
            onChange={setOpenedDate}
            placeholder="Pick a date"
          />
          {state.errors.openedDate && (
            <p className="text-sm text-destructive">
              {state.errors.openedDate[0]}
            </p>
          )}
        </div>

        {isEdit && (
          <div className="space-y-2">
            <Label>Closed Date</Label>
            <input type="hidden" name="closedDate" value={closedDate} />
            <DatePicker
              value={closedDate}
              onChange={setClosedDate}
              placeholder="Pick a date"
            />
            {state.errors.closedDate && (
              <p className="text-sm text-destructive">
                {state.errors.closedDate[0]}
              </p>
            )}
          </div>
        )}
      </div>

      {!isEdit && (
        <div className="space-y-2">
          <Label>Initial Balance</Label>
          <input type="hidden" name="initialBalance" value={initialBalance} />
          <CurrencyInput
            value={initialBalance}
            onChange={setInitialBalance}
            autoComplete="off"
            aria-invalid={state.errors.initialBalance ? true : undefined}
          />
          {state.errors.initialBalance && (
            <p className="text-sm text-destructive">
              {state.errors.initialBalance[0]}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/accounts")}
        >
          Cancel
        </Button>
        <SubmitButton isEdit={isEdit} />
      </div>
    </form>
  );
}
