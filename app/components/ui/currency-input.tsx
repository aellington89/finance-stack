"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { DollarSignIcon } from "lucide-react"

interface CurrencyInputProps
  extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  value: string
  onChange: (value: string) => void
}

function CurrencyInput({
  value,
  onChange,
  className,
  disabled,
  ...props
}: CurrencyInputProps) {
  function handleBlur() {
    if (!value) return
    const cleaned = value.replace(/[^0-9.\-]/g, "")
    const num = parseFloat(cleaned)
    if (!isNaN(num)) {
      onChange(num.toFixed(2))
    }
  }

  return (
    <InputGroup className={cn("h-8", className)}>
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <DollarSignIcon className="size-4" />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder="0.00"
        {...props}
      />
    </InputGroup>
  )
}

export { CurrencyInput }
