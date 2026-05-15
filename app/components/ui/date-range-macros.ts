export type Scope = "last" | "this";
export type Unit = "days" | "weeks" | "months" | "years";

export type MacroInput = {
  name: string;
  scope: Scope;
  count: number;
  unit: Unit;
};

export type Macro = MacroInput & {
  id: string;
};

export type BuiltInMacro = {
  id: string;
  name: string;
  scope: Scope;
  count: number;
  unit: Unit;
};

export const MACRO_STORAGE_KEY = "dateRangeMacros";
export const MACRO_LIMIT = 10;
export const MACRO_NAME_MAX_LENGTH = 50;
const STORAGE_VERSION = 1;

export const BUILT_IN_MACROS: ReadonlyArray<BuiltInMacro> = [
  { id: "builtin:last-7-days", name: "Last 7 days", scope: "last", count: 7, unit: "days" },
  { id: "builtin:last-30-days", name: "Last 30 days", scope: "last", count: 30, unit: "days" },
  { id: "builtin:this-month", name: "This month", scope: "this", count: 1, unit: "months" },
  { id: "builtin:this-year", name: "This year", scope: "this", count: 1, unit: "years" },
];

const VALID_SCOPES: ReadonlySet<Scope> = new Set<Scope>(["last", "this"]);
const VALID_UNITS: ReadonlySet<Unit> = new Set<Unit>(["days", "weeks", "months", "years"]);

function isValidMacro(value: unknown): value is Macro {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    v.name.length > 0 &&
    v.name.length <= MACRO_NAME_MAX_LENGTH &&
    typeof v.scope === "string" &&
    VALID_SCOPES.has(v.scope as Scope) &&
    typeof v.count === "number" &&
    Number.isFinite(v.count) &&
    v.count >= 1 &&
    typeof v.unit === "string" &&
    VALID_UNITS.has(v.unit as Unit)
  );
}

export function parseStoredMacros(value: string | null | undefined): Macro[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const macros = (parsed as { macros?: unknown }).macros;
    if (!Array.isArray(macros)) return [];
    return macros.filter(isValidMacro).slice(0, MACRO_LIMIT);
  } catch {
    return [];
  }
}

function serializeMacros(macros: Macro[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, macros });
}

export function loadMacros(): Macro[] {
  if (typeof window === "undefined") return [];
  try {
    return parseStoredMacros(window.localStorage.getItem(MACRO_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveMacros(macros: Macro[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MACRO_STORAGE_KEY, serializeMacros(macros));
  } catch {
    // localStorage unavailable (private mode, quota exceeded, blocked) —
    // the in-memory list still works for this session.
  }
}

export type AddMacroResult =
  | { ok: true; macros: Macro[]; added: Macro }
  | { ok: false; error: string };

export function addMacro(existing: Macro[], input: MacroInput): AddMacroResult {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "Name is required" };
  }
  if (name.length > MACRO_NAME_MAX_LENGTH) {
    return { ok: false, error: `Name must be at most ${MACRO_NAME_MAX_LENGTH} characters` };
  }
  const lower = name.toLowerCase();
  const builtInClash = BUILT_IN_MACROS.some((m) => m.name.toLowerCase() === lower);
  const userClash = existing.some((m) => m.name.toLowerCase() === lower);
  if (builtInClash || userClash) {
    return { ok: false, error: "A macro with that name already exists" };
  }
  if (existing.length >= MACRO_LIMIT) {
    return { ok: false, error: "Macro limit reached — delete one to add another" };
  }
  if (!VALID_SCOPES.has(input.scope)) {
    return { ok: false, error: "Invalid scope" };
  }
  if (!VALID_UNITS.has(input.unit)) {
    return { ok: false, error: "Invalid unit" };
  }
  if (!Number.isFinite(input.count) || input.count < 1) {
    return { ok: false, error: "Count must be a positive number" };
  }
  const added: Macro = {
    id: createMacroId(),
    name,
    scope: input.scope,
    count: input.count,
    unit: input.unit,
  };
  return { ok: true, macros: [...existing, added], added };
}

export function deleteMacro(existing: Macro[], id: string): Macro[] {
  return existing.filter((m) => m.id !== id);
}

function createMacroId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
