"use client"

import * as React from "react"
import {
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfWeek,
  startOfMonth,
  startOfYear,
  endOfWeek,
  endOfMonth,
  endOfYear,
  format,
} from "date-fns"
import { CalendarIcon, ArrowRightIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DateRangePickerProps {
  dateFrom?: string
  dateTo?: string
  onChange: (from: string | undefined, to: string | undefined) => void
  className?: string
}

type Scope = "last" | "this"
type Unit = "days" | "weeks" | "months" | "years"

function computeQuickRange(
  scope: Scope,
  count: number,
  unit: Unit
): { from: Date; to: Date } {
  const today = new Date()

  if (scope === "this") {
    switch (unit) {
      case "days":
        return { from: today, to: today }
      case "weeks":
        return { from: startOfWeek(today, { weekStartsOn: 0 }), to: today }
      case "months":
        return { from: startOfMonth(today), to: today }
      case "years":
        return { from: startOfYear(today), to: today }
    }
  }

  // scope === "last"
  switch (unit) {
    case "days":
      return { from: subDays(today, count), to: today }
    case "weeks": {
      const start = startOfWeek(subWeeks(today, count), { weekStartsOn: 0 })
      const end = endOfWeek(subWeeks(today, 1), { weekStartsOn: 0 })
      return { from: start, to: end }
    }
    case "months": {
      const start = startOfMonth(subMonths(today, count))
      const end = endOfMonth(subMonths(today, 1))
      return { from: start, to: end }
    }
    case "years": {
      const start = startOfYear(subYears(today, count))
      const end = endOfYear(subYears(today, 1))
      return { from: start, to: end }
    }
  }
}

function formatDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined
  return new Date(s + "T00:00:00")
}

const SCOPES: { value: Scope; label: string }[] = [
  { value: "last", label: "Last" },
  { value: "this", label: "This" },
]

const UNITS: { value: Unit; label: string }[] = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
]

function QuickSelect({
  onApply,
}: {
  onApply: (from: Date, to: Date) => void
}) {
  const [scope, setScope] = React.useState<Scope>("last")
  const [count, setCount] = React.useState(30)
  const [unit, setUnit] = React.useState<Unit>("days")

  const handleApply = () => {
    const range = computeQuickRange(scope, count, unit)
    onApply(range.from, range.to)
  }

  return (
    <div className="space-y-2 p-2">
      <p className="px-1 text-xs font-medium text-muted-foreground">
        Quick select
      </p>
      <div className="flex items-center gap-1.5">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="h-7 rounded-md border border-input bg-popover text-popover-foreground px-1.5 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
        >
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {scope === "last" && (
          <Input
            type="number"
            min={1}
            max={999}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            className="h-7 w-14 px-1.5 text-xs"
          />
        )}
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as Unit)}
          className="h-7 rounded-md border border-input bg-popover text-popover-foreground px-1.5 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
        >
          {UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {scope === "this" && u.value !== "days"
                ? u.label.replace(/s$/, "")
                : u.label}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        size="xs"
        variant="secondary"
        onClick={handleApply}
        className="w-full"
      >
        Apply
      </Button>
    </div>
  )
}

function DateRangePicker({
  dateFrom,
  dateTo,
  onChange,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)

  const from = parseDate(dateFrom)
  const to = parseDate(dateTo)

  const selected: DateRange | undefined =
    from || to ? { from, to } : undefined

  const handleQuickApply = (rangeFrom: Date, rangeTo: Date) => {
    onChange(formatDateStr(rangeFrom), formatDateStr(rangeTo))
    setOpen(false)
  }

  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range) {
      onChange(undefined, undefined)
      return
    }
    onChange(
      range.from ? formatDateStr(range.from) : undefined,
      range.to ? formatDateStr(range.to) : undefined
    )
    if (range.from && range.to) {
      setOpen(false)
    }
  }

  const handleManualDate = (which: "from" | "to", value: string) => {
    if (!value) {
      if (which === "from") onChange(undefined, dateTo)
      else onChange(dateFrom, undefined)
      return
    }
    // Validate YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
    const d = new Date(value + "T00:00:00")
    if (isNaN(d.getTime())) return
    if (which === "from") onChange(value, dateTo)
    else onChange(dateFrom, value)
  }

  // Build display text
  let displayText = "Select dates..."
  if (from && to) {
    displayText = `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`
  } else if (from) {
    displayText = `${format(from, "MMM d, yyyy")} – ...`
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !dateFrom && !dateTo && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon className="mr-2 size-4 shrink-0" />
        <span className="truncate">{displayText}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="border-r">
            <QuickSelect onApply={handleQuickApply} />
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              selected={selected}
              onSelect={handleRangeSelect}
              defaultMonth={from || to}
              numberOfMonths={2}
            />
            <div className="flex items-center gap-2 border-t px-2 py-2">
              <Input
                type="date"
                value={dateFrom ?? ""}
                onChange={(e) => handleManualDate("from", e.target.value)}
                className="h-7 flex-1 text-xs"
              />
              <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                type="date"
                value={dateTo ?? ""}
                onChange={(e) => handleManualDate("to", e.target.value)}
                className="h-7 flex-1 text-xs"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DateRangePicker }
