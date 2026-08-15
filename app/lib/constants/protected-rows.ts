// Which lookup rows /settings/categories refuses to rename or delete, and why
// (issue #109).
//
// Protection is derived from the constants that already declare these rows
// rather than stored as a `protected` column, because a column is a second
// declaration of a fact this repo already writes down — and the one time that
// duplication was allowed to drift (id 6 asserted in reference-ids.ts, seeded
// nowhere) it survived four releases. SHIPPED_ROWS is proved equal to
// shared-lookups.sql by `npm run check:seed-references`; a column living in
// each install's database is reachable by no gate at all.
//
// This is an application-level guard, not a database one. A BEFORE UPDATE OR
// DELETE trigger was considered and rejected: tests/integration/vitest-setup.ts
// re-converges these exact rows with ON CONFLICT DO UPDATE, and docs/database.md
// documents a manual UPDATE as the repair path for a drifted reference row.
// Both are legitimate, and a trigger would break them to stop a mistake nobody
// makes through psql.
//
// ── The two rules ────────────────────────────────────────────────────────
//
// APP-OWNED (SHIPPED_ROWS) — matched by id. These arrive identically on every
// install, so the id is stable and a name match would be too weak.
//
// LIABILITY-PIN (liability-categories.ts) — matched by id AND name. Those rows
// are the user's, ship nowhere, and are pinned by id only because the queries
// have no better handle on them yet (#111). Locking by id alone would lock
// whatever unrelated row happens to occupy id 7 on someone else's install; the
// name match makes protection self-limiting — a fresh install matches nothing
// and locks nothing.
//
// ── Renaming back is always allowed ──────────────────────────────────────
//
// The rule is "the name must equal the canonical name", not "this row is
// frozen". An install that renamed id 6 'Other' before this landed keeps that
// name — the seed is ON CONFLICT DO NOTHING and will not put it back — so a
// blanket rename refusal would trap /api/health/seed-data at 503 with no way
// out of the UI. Instead the only rename the guard permits is the one that
// restores the canonical name. Deletes are refused unconditionally.

import { SHIPPED_ROWS } from "@/lib/constants/reference-ids";
import {
  DEBT_INTEREST_CATEGORIES,
  DEBT_PAYMENT_CATEGORIES,
} from "@/lib/queries/liability-categories";

export type ProtectedTable =
  | "transaction_categories"
  | "transaction_types"
  | "account_type_categories";

export type ProtectionReason = "app-owned" | "liability-pin";

export interface Protection {
  reason: ProtectionReason;
  /**
   * The name this row is supposed to carry. A rename to exactly this value is
   * a repair and is allowed; every other rename, and every delete, is refused.
   */
  canonicalName: string;
}

// table -> id -> shipped name.
const SHIPPED_BY_TABLE: ReadonlyMap<string, ReadonlyMap<number, string>> = new Map(
  SHIPPED_ROWS.map((group) => [
    group.table,
    new Map(group.expected.map((row) => [row.id, row.name])),
  ]),
);

// id -> pinned name, for transaction_categories only.
const PINNED_CATEGORIES: ReadonlyMap<number, string> = new Map(
  [...DEBT_PAYMENT_CATEGORIES, ...DEBT_INTEREST_CATEGORIES].map((c) => [c.id, c.name]),
);

/**
 * Why this row is protected, or null if it is the user's to edit.
 *
 * `currentName` is the name the row carries in the database right now, which
 * is what the liability-pin rule matches on. The app-owned rule ignores it —
 * a shipped row stays protected under a drifted name, and `canonicalName`
 * comes back as the name it should have.
 */
export function protectionFor(
  table: ProtectedTable,
  id: number,
  currentName: string,
): Protection | null {
  const shippedName = SHIPPED_BY_TABLE.get(table)?.get(id);
  if (shippedName !== undefined) {
    return { reason: "app-owned", canonicalName: shippedName };
  }

  if (table === "transaction_categories") {
    const pinnedName = PINNED_CATEGORIES.get(id);
    if (pinnedName !== undefined && pinnedName === currentName) {
      return { reason: "liability-pin", canonicalName: pinnedName };
    }
  }

  return null;
}

/** Hover text for the lock icon in /settings/categories. */
export const PROTECTION_TOOLTIP: Record<ProtectionReason, string> = {
  "app-owned": "Ships with the app — renaming or deleting it would put this database out of step with a clean install.",
  "liability-pin": "The Liabilities drilldown reports on this category by name. Renaming or deleting it would silently drop it from Debt Service and the Debt Waterfall.",
};

const REASON_CLAUSE: Record<ProtectionReason, string> = {
  "app-owned": "it ships with the app",
  "liability-pin": "the Liabilities drilldown depends on it",
};

/**
 * The refusal a guarded action returns. Follows the guard-literal vocabulary
 * in docs/input-validation.md — authored text, no driver detail.
 */
export function protectionRefusal(
  protection: Protection,
  verb: "rename" | "delete",
  entityLabel: string,
): string {
  const why = `this ${entityLabel} is protected — ${REASON_CLAUSE[protection.reason]}`;

  if (verb === "delete") {
    return `Cannot delete: ${why}.`;
  }

  // Renaming back to canonical is the one edit that is allowed, so say so
  // rather than leaving a drifted install with a dead end.
  return `Cannot rename: ${why}. It can only be renamed back to "${protection.canonicalName}".`;
}
