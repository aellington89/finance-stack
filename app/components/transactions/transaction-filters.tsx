"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxList,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxItem,
  useComboboxAnchor,
} from "@/components/ui/combobox";

interface LookupOption {
  id: number;
  name: string;
}

interface TransactionFiltersProps {
  descriptions: string[];
  accounts: LookupOption[];
  types: LookupOption[];
  categories: LookupOption[];
  filters: {
    dateFrom?: string;
    dateTo?: string;
    descriptions?: string[];
    amount?: string;
    accountIds?: number[];
    typeIds?: number[];
    categoryIds?: number[];
  };
}

function FilterSlot({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function MultiSelectFilter({
  label,
  param,
  options,
  selectedIds,
  onUpdate,
}: {
  label: string;
  param: string;
  options: LookupOption[];
  selectedIds: number[];
  onUpdate: (param: string, values: number[]) => void;
}) {
  const anchor = useComboboxAnchor();

  return (
    <Combobox
      value={selectedIds}
      onValueChange={(val) => onUpdate(param, val as number[])}
      items={options.map((o) => o.id)}
      itemToStringLabel={(id: number) =>
        options.find((o) => o.id === id)?.name ?? String(id)
      }
      multiple
    >
      <ComboboxChips ref={anchor} className="h-8 text-xs">
        {selectedIds.map((chipId) => (
          <ComboboxChip key={chipId} className="text-xs">
            {options.find((o) => o.id === chipId)?.name}
          </ComboboxChip>
        ))}
        <ComboboxChipsInput
          placeholder={selectedIds.length === 0 ? `All ${label.toLowerCase()}s...` : ""}
          className="text-xs"
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
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
  );
}

function DescriptionFilter({
  descriptions,
  selectedDescriptions,
  onUpdate,
}: {
  descriptions: string[];
  selectedDescriptions: string[];
  onUpdate: (param: string, values: string[]) => void;
}) {
  const anchor = useComboboxAnchor();

  return (
    <Combobox
      value={selectedDescriptions}
      onValueChange={(val) => onUpdate("descriptions", val as string[])}
      items={descriptions}
      itemToStringLabel={(item: string) => item}
      multiple
    >
      <ComboboxChips ref={anchor} className="h-8 text-xs">
        {selectedDescriptions.map((chipValue) => (
          <ComboboxChip key={chipValue} className="text-xs">
            {chipValue}
          </ComboboxChip>
        ))}
        <ComboboxChipsInput
          placeholder={selectedDescriptions.length === 0 ? "All descriptions..." : ""}
          className="text-xs"
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxList>
          <ComboboxCollection>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxCollection>
          <ComboboxEmpty>No results found</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function TransactionFilters({
  descriptions,
  accounts,
  types,
  categories,
  filters,
}: TransactionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page"); // reset to page 1 on any filter change
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      const qs = params.toString();
      router.replace(`/dashboard/transactions${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams]
  );

  const handleDateRange = (from: string | undefined, to: string | undefined) => {
    updateParams({ dateFrom: from, dateTo: to });
  };

  const handleAmount = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateParams({ amount: e.target.value || undefined });
  };

  const handleMultiSelectIds = (param: string, values: number[]) => {
    updateParams({
      [param]: values.length > 0 ? values.join(",") : undefined,
    });
  };

  const handleDescriptions = (_param: string, values: string[]) => {
    updateParams({
      descriptions: values.length > 0 ? values.join(",") : undefined,
    });
  };

  const hasAnyFilter =
    filters.dateFrom ||
    filters.dateTo ||
    (filters.descriptions && filters.descriptions.length > 0) ||
    filters.amount ||
    (filters.accountIds && filters.accountIds.length > 0) ||
    (filters.typeIds && filters.typeIds.length > 0) ||
    (filters.categoryIds && filters.categoryIds.length > 0);

  const clearAll = () => {
    router.replace("/dashboard/transactions");
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <FilterSlot label="Date Range" className="w-56">
        <DateRangePicker
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onChange={handleDateRange}
          className="h-8 text-xs"
        />
      </FilterSlot>

      <FilterSlot label="Description" className="min-w-40 flex-1">
        <DescriptionFilter
          descriptions={descriptions}
          selectedDescriptions={filters.descriptions ?? []}
          onUpdate={handleDescriptions}
        />
      </FilterSlot>

      <FilterSlot label="Amount" className="w-28">
        <Input
          type="text"
          placeholder="e.g. 50.00"
          defaultValue={filters.amount ?? ""}
          onBlur={handleAmount}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAmount(e as unknown as React.ChangeEvent<HTMLInputElement>);
            }
          }}
          className="h-8 text-xs"
        />
      </FilterSlot>

      <FilterSlot label="Account" className="min-w-36 flex-1">
        <MultiSelectFilter
          label="Account"
          param="accountIds"
          options={accounts}
          selectedIds={filters.accountIds ?? []}
          onUpdate={handleMultiSelectIds}
        />
      </FilterSlot>

      <FilterSlot label="Type" className="min-w-32 flex-1">
        <MultiSelectFilter
          label="Type"
          param="typeIds"
          options={types}
          selectedIds={filters.typeIds ?? []}
          onUpdate={handleMultiSelectIds}
        />
      </FilterSlot>

      <FilterSlot label="Category" className="min-w-32 flex-1">
        <MultiSelectFilter
          label="Category"
          param="categoryIds"
          options={categories}
          selectedIds={filters.categoryIds ?? []}
          onUpdate={handleMultiSelectIds}
        />
      </FilterSlot>

      {hasAnyFilter && (
        <Button variant="ghost" size="xs" onClick={clearAll} className="mb-0.5">
          Clear All
        </Button>
      )}
    </div>
  );
}
