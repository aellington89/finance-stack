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
// ── The rule ─────────────────────────────────────────────────────────────
//
// APP-OWNED (SHIPPED_ROWS) — matched by id. These arrive identically on every
// install, so the id is stable and a name match would be too weak.
//
// There used to be a second rule. LIABILITY-PIN locked the fifteen
// transaction_categories rows the Debt Service and Debt Waterfall queries named
// by id, matched on id AND name together so that protection was self-limiting
// on an install where those ids held unrelated rows. Issue #111 removed it,
// along with the pins themselves: the meaning those rows carried now lives in
// transaction_categories.reporting_role, so renaming "Mortgage Principle" no
// longer drops it out of an aggregate and there is nothing left to protect it
// from. They are the user's rows and are once again fully editable, which is
// what the seed-data taxonomy always said they were.
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

export type ProtectedTable =
  | "transaction_categories"
  | "transaction_types"
  | "account_type_categories";

export type ProtectionReason = "app-owned";

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

/**
 * Why this row is protected, or null if it is the user's to edit.
 *
 * The rule ignores the row's current name — a shipped row stays protected under
 * a drifted name, and `canonicalName` comes back as the name it should have,
 * which is what makes the rename-back repair possible.
 */
export function protectionFor(table: ProtectedTable, id: number): Protection | null {
  const shippedName = SHIPPED_BY_TABLE.get(table)?.get(id);
  if (shippedName !== undefined) {
    return { reason: "app-owned", canonicalName: shippedName };
  }

  return null;
}

/** Hover text for the lock icon in /settings/categories. */
export const PROTECTION_TOOLTIP: Record<ProtectionReason, string> = {
  "app-owned": "Ships with the app — renaming or deleting it would put this database out of step with a clean install.",
};

const REASON_CLAUSE: Record<ProtectionReason, string> = {
  "app-owned": "it ships with the app",
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
