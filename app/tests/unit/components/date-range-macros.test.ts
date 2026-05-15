import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseStoredMacros,
  addMacro,
  deleteMacro,
  loadMacros,
  saveMacros,
  MACRO_LIMIT,
  MACRO_NAME_MAX_LENGTH,
  type Macro,
} from "@/components/ui/date-range-macros";

const validMacro = (overrides: Partial<Macro> = {}): Macro => ({
  id: "id-1",
  name: "Valid",
  scope: "last",
  count: 30,
  unit: "days",
  ...overrides,
});

describe("parseStoredMacros", () => {
  it("returns [] for null / undefined / empty string", () => {
    expect(parseStoredMacros(null)).toEqual([]);
    expect(parseStoredMacros(undefined)).toEqual([]);
    expect(parseStoredMacros("")).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseStoredMacros("{not json")).toEqual([]);
  });

  it("returns [] when the top-level value is not an object", () => {
    expect(parseStoredMacros("[]")).toEqual([]);
    expect(parseStoredMacros("42")).toEqual([]);
    expect(parseStoredMacros("null")).toEqual([]);
    expect(parseStoredMacros('"string"')).toEqual([]);
  });

  it("returns [] when macros is missing or not an array", () => {
    expect(parseStoredMacros(JSON.stringify({ version: 1 }))).toEqual([]);
    expect(parseStoredMacros(JSON.stringify({ version: 1, macros: "nope" }))).toEqual([]);
  });

  it("filters out structurally invalid macro entries", () => {
    const stored = JSON.stringify({
      version: 1,
      macros: [
        validMacro({ id: "ok", name: "OK" }),
        { ...validMacro(), scope: "next" },
        { ...validMacro(), unit: "decades" },
        { ...validMacro(), name: "" },
        { ...validMacro(), count: -5 },
        { ...validMacro(), count: 0 },
        { ...validMacro(), count: "30" },
        { id: "", name: "Empty id", scope: "last", count: 7, unit: "days" },
        "not an object",
        null,
        { name: "Missing id", scope: "last", count: 7, unit: "days" },
      ],
    });
    const result = parseStoredMacros(stored);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("OK");
  });

  it("rejects names longer than the max length", () => {
    const stored = JSON.stringify({
      version: 1,
      macros: [validMacro({ name: "x".repeat(MACRO_NAME_MAX_LENGTH + 1) })],
    });
    expect(parseStoredMacros(stored)).toEqual([]);
  });

  it("caps the returned list at MACRO_LIMIT", () => {
    const macros = Array.from({ length: MACRO_LIMIT + 5 }, (_, i) =>
      validMacro({ id: `m${i}`, name: `Macro ${i}` })
    );
    const result = parseStoredMacros(JSON.stringify({ version: 1, macros }));
    expect(result).toHaveLength(MACRO_LIMIT);
  });
});

describe("addMacro", () => {
  const input = { name: "Test", scope: "last", count: 14, unit: "days" } as const;

  it("adds a valid macro and assigns a non-empty id", () => {
    const result = addMacro([], input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.macros).toHaveLength(1);
    expect(result.macros[0].id).toBeTruthy();
    expect(result.macros[0].name).toBe("Test");
    expect(result.added).toEqual(result.macros[0]);
  });

  it("trims whitespace from the name", () => {
    const result = addMacro([], { ...input, name: "  Spaced  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.macros[0].name).toBe("Spaced");
  });

  it("rejects empty or whitespace-only names", () => {
    expect(addMacro([], { ...input, name: "" }).ok).toBe(false);
    expect(addMacro([], { ...input, name: "   " }).ok).toBe(false);
  });

  it("rejects names longer than the max length", () => {
    const longName = "x".repeat(MACRO_NAME_MAX_LENGTH + 1);
    expect(addMacro([], { ...input, name: longName }).ok).toBe(false);
  });

  it("rejects duplicate names case-insensitively", () => {
    const existing: Macro[] = [validMacro({ id: "1", name: "My Macro" })];
    const result = addMacro(existing, { ...input, name: "MY MACRO" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already exists/i);
  });

  it("rejects names that collide with built-ins (case-insensitive)", () => {
    expect(addMacro([], { ...input, name: "last 30 days" }).ok).toBe(false);
    expect(addMacro([], { ...input, name: "THIS MONTH" }).ok).toBe(false);
  });

  it("rejects new macro when at the cap", () => {
    const existing: Macro[] = Array.from({ length: MACRO_LIMIT }, (_, i) =>
      validMacro({ id: `${i}`, name: `User ${i}` })
    );
    const result = addMacro(existing, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/limit/i);
  });

  it("rejects invalid count / scope / unit", () => {
    expect(addMacro([], { ...input, count: 0 }).ok).toBe(false);
    expect(addMacro([], { ...input, count: NaN }).ok).toBe(false);
    expect(addMacro([], { ...input, scope: "next" as never }).ok).toBe(false);
    expect(addMacro([], { ...input, unit: "decades" as never }).ok).toBe(false);
  });

  it("does not mutate the input array", () => {
    const existing: Macro[] = [];
    addMacro(existing, input);
    expect(existing).toHaveLength(0);
  });
});

describe("deleteMacro", () => {
  const existing: Macro[] = [
    validMacro({ id: "a", name: "A" }),
    validMacro({ id: "b", name: "B" }),
  ];

  it("removes the macro with the matching id", () => {
    expect(deleteMacro(existing, "a").map((m) => m.id)).toEqual(["b"]);
  });

  it("is a no-op for an unknown id", () => {
    expect(deleteMacro(existing, "zzz").map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...existing];
    deleteMacro(existing, "a");
    expect(existing).toEqual(copy);
  });
});

describe("loadMacros / saveMacros", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadMacros returns [] when window is undefined (SSR / node env)", () => {
    expect(loadMacros()).toEqual([]);
  });

  it("saveMacros does not throw when window is undefined", () => {
    expect(() => saveMacros([validMacro()])).not.toThrow();
  });

  it("loadMacros returns [] when localStorage.getItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      },
    });
    expect(loadMacros()).toEqual([]);
  });

  it("saveMacros silently swallows localStorage.setItem errors", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    });
    expect(() => saveMacros([validMacro()])).not.toThrow();
  });

  it("round-trips macros through localStorage", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
    });
    const macros: Macro[] = [validMacro({ id: "1", name: "Saved" })];
    saveMacros(macros);
    expect(loadMacros()).toEqual(macros);
  });
});
