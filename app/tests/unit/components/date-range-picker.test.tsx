import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MACRO_LIMIT, MACRO_STORAGE_KEY } from "@/components/ui/date-range-macros";

// Quick Select's saved macros, end to end through the picker (Issue #193).
// date-range-macros.test.ts covers the pure helpers; this covers the component
// that loads, saves and deletes through them, which nothing tested while its
// list was seeded from an effect. Written against that effect version first,
// so a pass here is the evidence the rewrite kept the behaviour.

function store(names: string[]) {
  localStorage.setItem(
    MACRO_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      macros: names.map((name, i) => ({ id: `m${i}`, name, scope: "last", count: 3, unit: "months" })),
    })
  );
}

function storedNames(): string[] {
  const raw = localStorage.getItem(MACRO_STORAGE_KEY);
  return raw ? JSON.parse(raw).macros.map((m: { name: string }) => m.name) : [];
}

// The macros live in QuickSelect, which the popover renders only once it is
// open.
async function openPicker() {
  const user = userEvent.setup();
  render(<DateRangePicker onChange={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /select dates/i }));
  await screen.findByText("Quick select");
  return user;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DateRangePicker saved macros", () => {
  it("lists stored macros when the picker opens", async () => {
    store(["Quarter-ish"]);
    await openPicker();

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quarter-ish" })).toBeInTheDocument();
  });

  it("shows no Saved section when nothing is stored", async () => {
    await openPicker();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("saves a macro to the list and to localStorage", async () => {
    const user = await openPicker();

    await user.click(screen.getByRole("button", { name: "Save as…" }));
    await user.type(screen.getByPlaceholderText("Macro name"), "Mine{Enter}");

    expect(screen.getByRole("button", { name: "Mine" })).toBeInTheDocument();
    expect(storedNames()).toEqual(["Mine"]);
  });

  it("deletes a macro from the list and from localStorage", async () => {
    store(["Quarter-ish", "Other"]);
    const user = await openPicker();

    await user.click(screen.getByRole("button", { name: "Delete Quarter-ish" }));

    expect(screen.queryByRole("button", { name: "Quarter-ish" })).not.toBeInTheDocument();
    expect(storedNames()).toEqual(["Other"]);
  });

  // saveMacros swallows a failed write so the in-memory list still works for
  // the session (private mode, a full quota). The list has to be component
  // state for that to hold, not a read-back of storage.
  it("keeps a saved macro for the session when localStorage rejects the write", async () => {
    const user = await openPicker();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    await user.click(screen.getByRole("button", { name: "Save as…" }));
    await user.type(screen.getByPlaceholderText("Macro name"), "Ephemeral{Enter}");

    expect(screen.getByRole("button", { name: "Ephemeral" })).toBeInTheDocument();
  });

  it("disables Save as… once the stored list is at the limit", async () => {
    store(Array.from({ length: MACRO_LIMIT }, (_, i) => `Macro ${i}`));
    await openPicker();

    expect(screen.getByRole("button", { name: "Save as…" })).toBeDisabled();
  });

  // Today this holds twice over: the popover renders nothing while closed, so
  // QuickSelect is never in server HTML at all, and the component's hydration
  // gate would keep the list out even if it were. jsdom has a window, so the
  // stored macros are readable here, which a real server render cannot do.
  it("never server-renders saved macros", () => {
    store(["Quarter-ish"]);
    expect(renderToString(<DateRangePicker onChange={() => {}} />)).not.toContain("Quarter-ish");
  });
});
