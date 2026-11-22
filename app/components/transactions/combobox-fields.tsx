"use client";

import { Label } from "@/components/ui/label";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
} from "@/components/ui/combobox";

/**
 * The account, type and category pickers shared by the New Transaction form
 * and the recurring-transaction dialog (Issue #135). Moved here unchanged from
 * transaction-form.tsx. Each posts its value through a hidden input named
 * `name`, and gives the visible input `id={name}` for its label.
 */

export interface LookupOption {
  id: number;
  name: string;
}

export function ComboboxField({
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
        {/* `id` rather than the hidden input alone: <Label htmlFor={name}>
            above points at an id, and the only element carrying `name` here is
            a hidden input with no id — so the field had no accessible label at
            all. Fixing that is also what gives the E2E suite a getByLabel()
            handle on it (Issue #141). */}
        <ComboboxInput
          id={name}
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

export function ClearableComboboxField({
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
        {/* id={name} for the label association — see ComboboxField above. */}
        <ComboboxInput
          id={name}
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
