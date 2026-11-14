import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from "@/components/ui/combobox";

// Issue #426. The trigger and clear buttons render only an icon, so without a
// name a screen reader announces "button" with no label. The wrapper supplies
// the default; `triggerAriaLabel` lets a field name its own trigger.
function Fixture({
  triggerAriaLabel,
  value,
}: {
  triggerAriaLabel?: string;
  value?: string | null;
}) {
  return (
    <Combobox items={["checking", "savings"]} value={value ?? null}>
      <ComboboxInput
        aria-label="Account type"
        showTrigger
        showClear
        triggerAriaLabel={triggerAriaLabel}
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxItem value="checking">Checking</ComboboxItem>
          <ComboboxItem value="savings">Savings</ComboboxItem>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

describe("ComboboxInput accessible names", () => {
  it("names the trigger by default", () => {
    render(<Fixture />);

    expect(screen.getByRole("button", { name: "Show options" })).toBeInTheDocument();
  });

  it("lets a field override the trigger name", () => {
    render(<Fixture triggerAriaLabel="Show account types" />);

    expect(
      screen.getByRole("button", { name: "Show account types" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show options" })
    ).not.toBeInTheDocument();
  });

  it("names the clear button when a value is selected", () => {
    render(<Fixture value="checking" />);

    expect(
      screen.getByRole("button", { name: "Clear selection" })
    ).toBeInTheDocument();
  });
});
