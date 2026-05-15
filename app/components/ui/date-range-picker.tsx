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
import { CalendarIcon, ArrowRightIcon, XIcon } from "lucide-react"
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
import {
  BUILT_IN_MACROS,
  MACRO_LIMIT,
  MACRO_NAME_MAX_LENGTH,
  addMacro,
  deleteMacro,
  loadMacros,
  saveMacros,
  type Macro,
  type Scope,
  type Unit,
} from "@/components/ui/date-range-macros"

interface DateRangePickerProps {
  dateFrom?: string
  dateTo?: string
  onChange: (from: string | undefined, to: string | undefined) => void
  className?: string
  placeholder?: string
}

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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDate(s?: string): Date | undefined {
  if (!s || !ISO_DATE_RE.test(s)) return undefined
  const d = new Date(s + "T00:00:00")
  return isNaN(d.getTime()) ? undefined : d
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

  const [userMacros, setUserMacros] = React.useState<Macro[]>([])
  const [hydrated, setHydrated] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveName, setSaveName] = React.useState("")
  const [saveError, setSaveError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setUserMacros(loadMacros())
    setHydrated(true)
  }, [])

  const applyConfig = (config: { scope: Scope; count: number; unit: Unit }) => {
    const range = computeQuickRange(config.scope, config.count, config.unit)
    onApply(range.from, range.to)
  }

  const handleApply = () => {
    applyConfig({ scope, count, unit })
  }

  const handleStartSave = () => {
    setIsSaving(true)
    setSaveName("")
    setSaveError(null)
  }

  const handleCancelSave = () => {
    setIsSaving(false)
    setSaveName("")
    setSaveError(null)
  }

  const handleConfirmSave = () => {
    const result = addMacro(userMacros, { name: saveName, scope, count, unit })
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    setUserMacros(result.macros)
    saveMacros(result.macros)
    setIsSaving(false)
    setSaveName("")
    setSaveError(null)
  }

  const handleDeleteMacro = (id: string) => {
    const next = deleteMacro(userMacros, id)
    setUserMacros(next)
    saveMacros(next)
  }

  const atLimit = userMacros.length >= MACRO_LIMIT

  return (
    <div className="w-52 space-y-2 p-2">
      <p className="px-1 text-xs font-medium text-muted-foreground">
        Quick select
      </p>

      <div className="space-y-0.5">
        {BUILT_IN_MACROS.map((m) => (
          <Button
            key={m.id}
            type="button"
            size="xs"
            variant="ghost"
            className="w-full justify-start px-2 text-xs font-normal"
            onClick={() => applyConfig(m)}
          >
            {m.name}
          </Button>
        ))}
      </div>

      {hydrated && userMacros.length > 0 && (
        <div className="space-y-0.5">
          <p className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Saved
          </p>
          {userMacros.map((m) => (
            <div key={m.id} className="group flex items-center gap-0.5">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="flex-1 justify-start px-2 text-xs font-normal"
                onClick={() => applyConfig(m)}
              >
                <span className="truncate">{m.name}</span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label={`Delete ${m.name}`}
                className="size-6 shrink-0 px-0 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => handleDeleteMacro(m.id)}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 border-t pt-2">
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

        {!isSaving ? (
          <div className="flex gap-1">
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={handleApply}
              className="flex-1"
            >
              Apply
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={handleStartSave}
              disabled={atLimit}
              title={
                atLimit
                  ? "Macro limit reached — delete one to add another"
                  : undefined
              }
              className="flex-1"
            >
              Save as…
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <Input
              type="text"
              autoFocus
              maxLength={MACRO_NAME_MAX_LENGTH}
              value={saveName}
              onChange={(e) => {
                setSaveName(e.target.value)
                setSaveError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleConfirmSave()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  handleCancelSave()
                }
              }}
              placeholder="Macro name"
              className="h-7 text-xs"
            />
            <div className="flex gap-1">
              <Button
                type="button"
                size="xs"
                variant="default"
                onClick={handleConfirmSave}
                disabled={!saveName.trim()}
                className="flex-1"
              >
                Save
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={handleCancelSave}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
            {saveError && (
              <p className="text-[10px] text-destructive">{saveError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface Draft {
  from: Date | undefined
  to: Date | undefined
  fromStr: string
  toStr: string
}

function buildDraft(dateFrom?: string, dateTo?: string): Draft {
  return {
    from: parseDate(dateFrom),
    to: parseDate(dateTo),
    fromStr: dateFrom ?? "",
    toStr: dateTo ?? "",
  }
}

function DateRangePicker({
  dateFrom,
  dateTo,
  onChange,
  className,
  placeholder = "Select dates...",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft>(() =>
    buildDraft(dateFrom, dateTo)
  )

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Re-sync from props each time the popover opens; discards any
      // uncommitted draft from a previously cancelled session.
      setDraft(buildDraft(dateFrom, dateTo))
    }
    setOpen(next)
  }

  const selected: DateRange | undefined =
    draft.from || draft.to ? { from: draft.from, to: draft.to } : undefined

  const handleQuickApply = (rangeFrom: Date, rangeTo: Date) => {
    onChange(formatDateStr(rangeFrom), formatDateStr(rangeTo))
    setOpen(false)
  }

  const handleRangeSelect = (
    _range: DateRange | undefined,
    triggerDate: Date
  ) => {
    // Track clicks manually using `triggerDate`. react-day-picker's own range
    // computation has two annoying behaviors we override here:
    //   1. Clicking inside a complete range shrinks it to the closer endpoint
    //      instead of starting a fresh selection.
    //   2. Clicking before an in-progress `from` swaps so the new click becomes
    //      `from` — fine for that case, but combined with (1) it makes editing
    //      an existing range feel unpredictable.
    // Two-click model: 1st click sets `from`, 2nd click sets `to` (sorted for
    // display). A 3rd click while complete restarts from that date.
    setDraft((d) => {
      if (!d.from || d.to) {
        // No selection yet, or range already complete → start fresh
        return {
          from: triggerDate,
          to: undefined,
          fromStr: formatDateStr(triggerDate),
          toStr: "",
        }
      }
      // Only `from` is set → complete the range with this click
      let from = d.from
      let to = triggerDate
      if (to < from) {
        [from, to] = [to, from]
      }
      return {
        from,
        to,
        fromStr: formatDateStr(from),
        toStr: formatDateStr(to),
      }
    })
  }

  const handleManualDate = (which: "from" | "to", value: string) => {
    const parsed = parseDate(value)
    if (which === "from") {
      setDraft((d) => ({ ...d, fromStr: value, from: parsed ?? d.from }))
    } else {
      setDraft((d) => ({ ...d, toStr: value, to: parsed ?? d.to }))
    }
  }

  const handleApply = () => {
    let fromStr = draft.fromStr.trim() || undefined
    let toStr = draft.toStr.trim() || undefined

    // Drop strings that don't parse — never silently commit garbage.
    if (fromStr && !parseDate(fromStr)) fromStr = undefined
    if (toStr && !parseDate(toStr)) toStr = undefined

    if (fromStr && toStr && fromStr > toStr) {
      [fromStr, toStr] = [toStr, fromStr]
    }

    onChange(fromStr, toStr)
    setOpen(false)
  }

  const handleClear = () => {
    onChange(undefined, undefined)
    setDraft({ from: undefined, to: undefined, fromStr: "", toStr: "" })
    setOpen(false)
  }

  // Build trigger display text from committed props (not draft).
  const triggerFrom = parseDate(dateFrom)
  const triggerTo = parseDate(dateTo)
  let displayText = placeholder
  if (triggerFrom && triggerTo) {
    displayText = `${format(triggerFrom, "MMM d")} – ${format(triggerTo, "MMM d, yyyy")}`
  } else if (triggerFrom) {
    displayText = `${format(triggerFrom, "MMM d, yyyy")} – ...`
  } else if (triggerTo) {
    displayText = `... – ${format(triggerTo, "MMM d, yyyy")}`
  }

  const isEmpty = !dateFrom && !dateTo

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              isEmpty && "text-muted-foreground",
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
              defaultMonth={draft.from || draft.to}
              numberOfMonths={2}
            />
            <div className="flex items-center gap-2 border-t px-2 py-2">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={draft.fromStr}
                onChange={(e) => handleManualDate("from", e.target.value)}
                className="h-7 flex-1 text-xs"
              />
              <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={draft.toStr}
                onChange={(e) => handleManualDate("to", e.target.value)}
                className="h-7 flex-1 text-xs"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-2 pb-2">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={handleClear}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="xs"
                variant="default"
                onClick={handleApply}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DateRangePicker }
