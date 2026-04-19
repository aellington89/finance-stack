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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

interface AccountTypeOption extends LookupOption {
  liquidityClass: string | null;
}

interface AccountData {
  accountId: number;
  accountName: string;
  accountTypeId: number;
  accountIdentifier: string | null;
  openedDate: string | null;
  closedDate: string | null;
  liquidityClass: string | null;
}

interface AccountFormProps {
  accountTypes: AccountTypeOption[];
  account?: AccountData;
  defaultTypeId?: number;
}

const LIQUIDITY_LABELS: Record<string, string> = {
  liquid: "Liquid",
  semi_liquid: "Semi-liquid",
  illiquid: "Illiquid",
  restricted: "Restricted",
};

const LIQUIDITY_OPTIONS = [
  { value: "liquid", label: "Liquid" },
  { value: "semi_liquid", label: "Semi-liquid" },
  { value: "illiquid", label: "Illiquid" },
  { value: "restricted", label: "Restricted" },
] as const;

const INHERIT_SENTINEL = "inherit";

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
  const [liquidityClass, setLiquidityClass] = useState<string>(
    account?.liquidityClass ?? INHERIT_SENTINEL
  );

  const selectedType = accountTypes.find(
    (t) => String(t.id) === accountTypeId
  );
  const typeDefaultLiquidity = selectedType?.liquidityClass ?? null;

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
        <Label htmlFor="liquidityClass">Liquidity</Label>
        <input
          type="hidden"
          name="liquidityClass"
          value={liquidityClass === INHERIT_SENTINEL ? "" : liquidityClass}
        />
        <Select
          value={liquidityClass}
          onValueChange={(val) => setLiquidityClass(val ?? INHERIT_SENTINEL)}
        >
          <SelectTrigger id="liquidityClass" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_SENTINEL}>Inherit from type</SelectItem>
            {LIQUIDITY_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {typeDefaultLiquidity && (
          <p className="text-xs text-muted-foreground">
            Default for this type: {LIQUIDITY_LABELS[typeDefaultLiquidity] ?? typeDefaultLiquidity}
          </p>
        )}
        {state.errors.liquidityClass && (
          <p className="text-sm text-destructive">
            {state.errors.liquidityClass[0]}
          </p>
        )}
      </div>

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
