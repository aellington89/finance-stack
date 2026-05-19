"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
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

const TIME_GROUPING_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "day_of_week", label: "Day of Week" },
  { value: "day_of_month", label: "Day of Month" },
  { value: "day_of_year", label: "Day of Year" },
  { value: "week_of_year", label: "Week of Year" },
  { value: "month_of_year", label: "Month of Year" },
  { value: "quarter_of_year", label: "Quarter of Year" },
] as const;

const TIME_GROUPING_LABELS: Record<string, string> = Object.fromEntries(
  TIME_GROUPING_OPTIONS.map(({ value, label }) => [value, label])
);

interface LookupOption {
  id: number;
  name: string;
}

interface AccountingFiltersProps {
  descriptions: string[];
  accounts: LookupOption[];
  categories: LookupOption[];
  filters: {
    dateFrom?: string;
    dateTo?: string;
    descriptions?: string[];
    accountIds?: number[];
    categoryIds?: number[];
    timeGrouping?: string;
  };
}

function FilterSlot({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
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
      <ComboboxChips ref={anchor} className="overflow-hidden flex-nowrap">
        {selectedIds.slice(0, 2).map((chipId) => (
          <ComboboxChip key={chipId} className="shrink-0">
            {options.find((o) => o.id === chipId)?.name}
          </ComboboxChip>
        ))}
        {selectedIds.length > 2 && (
          <span
            className="shrink-0 cursor-default rounded-sm bg-muted px-1.5 text-sm font-medium text-muted-foreground"
            title={selectedIds
              .slice(2)
              .map((id) => options.find((o) => o.id === id)?.name)
              .join(", ")}
          >
            +{selectedIds.length - 2}
          </span>
        )}
        <ComboboxChipsInput
          placeholder={
            selectedIds.length === 0 ? `All ${label.toLowerCase()}s...` : ""
          }
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
      <ComboboxChips ref={anchor} className="overflow-hidden flex-nowrap">
        {selectedDescriptions.slice(0, 2).map((chipValue) => (
          <ComboboxChip key={chipValue} className="shrink-0">
            {chipValue}
          </ComboboxChip>
        ))}
        {selectedDescriptions.length > 2 && (
          <span
            className="shrink-0 cursor-default rounded-sm bg-muted px-1.5 text-sm font-medium text-muted-foreground"
            title={selectedDescriptions.slice(2).join(", ")}
          >
            +{selectedDescriptions.length - 2}
          </span>
        )}
        <ComboboxChipsInput
          placeholder={
            selectedDescriptions.length === 0 ? "All descriptions..." : ""
          }
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

export function AccountingFilters({
  descriptions,
  accounts,
  categories,
  filters,
}: AccountingFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      const qs = params.toString();
      router.push(`/dashboard/accounting${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams]
  );

  const handleDateRange = (
    from: string | undefined,
    to: string | undefined
  ) => {
    updateParams({ dateFrom: from, dateTo: to });
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

  const handleTimeGrouping = (value: string | null) => {
    const v = value ?? "month";
    updateParams({
      timeGrouping: v === "month" ? undefined : v, // month is default
    });
  };

  const hasAnyFilter =
    filters.dateFrom ||
    filters.dateTo ||
    (filters.descriptions && filters.descriptions.length > 0) ||
    (filters.accountIds && filters.accountIds.length > 0) ||
    (filters.categoryIds && filters.categoryIds.length > 0) ||
    (filters.timeGrouping && filters.timeGrouping !== "month");

  const clearAll = () => {
    router.push("/dashboard/accounting");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSlot className="w-56">
        <DateRangePicker
          dateFrom={filters.dateFrom ?? undefined}
          dateTo={filters.dateTo ?? undefined}
          onChange={handleDateRange}
          placeholder="Last 30 days (default)"
        />
      </FilterSlot>

      <FilterSlot className="min-w-40 flex-1">
        <DescriptionFilter
          descriptions={descriptions}
          selectedDescriptions={filters.descriptions ?? []}
          onUpdate={handleDescriptions}
        />
      </FilterSlot>

      <FilterSlot className="min-w-36 flex-1">
        <MultiSelectFilter
          label="Account"
          param="accountIds"
          options={accounts}
          selectedIds={filters.accountIds ?? []}
          onUpdate={handleMultiSelectIds}
        />
      </FilterSlot>

      <FilterSlot className="min-w-36 flex-1">
        <MultiSelectFilter
          label="Category"
          param="categoryIds"
          options={categories}
          selectedIds={filters.categoryIds ?? []}
          onUpdate={handleMultiSelectIds}
        />
      </FilterSlot>

      <FilterSlot className="w-36">
        <Select
          value={filters.timeGrouping ?? "month"}
          onValueChange={handleTimeGrouping}
        >
          <SelectTrigger>
            <span>{TIME_GROUPING_LABELS[filters.timeGrouping ?? "month"]}</span>
          </SelectTrigger>
          <SelectContent>
            {TIME_GROUPING_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterSlot>

      {hasAnyFilter && (
        <Button variant="ghost" size="xs" onClick={clearAll}>
          Clear All
        </Button>
      )}
    </div>
  );
}
