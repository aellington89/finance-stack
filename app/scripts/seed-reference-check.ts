// Pure parse + diff helpers backing the seed-reference CI gate
// (app/scripts/check-seed-references.ts). Kept side-effect-free so the unit
// suite can exercise the logic against inline SQL fixtures without touching the
// filesystem or the process exit code.
//
// The gate has two halves:
//
//   1. Reference agreement (findSeedReferenceMismatches) — directional: every
//      SEED_REFERENCES (table, id, name) must match the matching INSERT row in
//      init-db/seeds/shared-lookups.sql, but unreferenced seed rows are fine.
//      It is also fail-closed — a referenced table with no INSERT block in the
//      seed trips the gate unless it is intentionally seeded elsewhere (see
//      TABLES_ALLOWED_ABSENT).
//   2. Seed safety contract (findUnsafeSeedStatements) — the seed file is
//      applied unconditionally to the live Finances database on every migrate
//      run (issue #187), so every statement in it must be additive and
//      re-runnable. See that function for the rules.

import type { SeedReferenceGroup } from "@/lib/constants/reference-ids";

// Tables referenced by SEED_REFERENCES that are deliberately NOT in
// shared-lookups.sql. transaction_categories is seeded per-database elsewhere
// (finances-test-mock-data.sql for the test DB; production has no seed for it),
// so it has no row in the shared file — its row-level protection is tracked in
// #109. Any other absent table is treated as a bug and fails the gate.
export const TABLES_ALLOWED_ABSENT = new Set<string>(["transaction_categories"]);

export type MismatchReason = "name" | "missing-row" | "missing-table";

export interface Mismatch {
  table: string;
  // id/expected are null only for a whole-table miss (reason "missing-table").
  id: number | null;
  expected: string | null;
  // actual is the seed-side name for "name", and null for "missing-row" /
  // "missing-table".
  actual: string | null;
  reason: MismatchReason;
}

// Parse the `INSERT INTO <table> (...) [OVERRIDING SYSTEM VALUE] VALUES
// (id, 'name'), ... ON CONFLICT ...` blocks from a hand-authored seed file into
// table -> (id -> name). UPDATE / SELECT setval statements carry no
// `VALUES ... ON CONFLICT` and are ignored. Names are single-quoted with SQL ''
// escaping; the seed file is hand-authored and stable, so per-block regex is
// sufficient (see #155).
export function parseSeedRows(sql: string): Map<string, Map<number, string>> {
  const tables = new Map<string, Map<number, string>>();
  // [\s\S]*? (rather than the `s`/dotAll flag) keeps the multi-line VALUES body
  // match compatible with the ES2017 tsconfig target.
  const blockRe =
    /INSERT\s+INTO\s+(\w+)\s*\([^)]*\)\s*(?:OVERRIDING\s+SYSTEM\s+VALUE\s+)?VALUES\s*([\s\S]*?)\s*ON\s+CONFLICT/gi;
  const rowRe = /\(\s*(\d+)\s*,\s*'((?:[^']|'')*)'\s*\)/g;

  for (const block of sql.matchAll(blockRe)) {
    const table = block[1].toLowerCase();
    const rows = tables.get(table) ?? new Map<number, string>();
    for (const row of block[2].matchAll(rowRe)) {
      rows.set(Number(row[1]), row[2].replace(/''/g, "'"));
    }
    tables.set(table, rows);
  }

  return tables;
}

// Cross-check each SEED_REFERENCES (table, id, name) against the parsed seed.
// Returns one Mismatch per divergence; an empty array means code and seed agree.
export function findSeedReferenceMismatches(
  seedReferences: ReadonlyArray<SeedReferenceGroup>,
  sql: string,
): Mismatch[] {
  const seed = parseSeedRows(sql);
  const mismatches: Mismatch[] = [];

  for (const group of seedReferences) {
    const seedRows = seed.get(group.table.toLowerCase());

    if (!seedRows) {
      if (TABLES_ALLOWED_ABSENT.has(group.table.toLowerCase())) continue;
      mismatches.push({
        table: group.table,
        id: null,
        expected: null,
        actual: null,
        reason: "missing-table",
      });
      continue;
    }

    for (const { id, name } of group.expected) {
      const actual = seedRows.get(id);
      if (actual === undefined) {
        mismatches.push({ table: group.table, id, expected: name, actual: null, reason: "missing-row" });
      } else if (actual !== name) {
        mismatches.push({ table: group.table, id, expected: name, actual, reason: "name" });
      }
    }
  }

  return mismatches;
}

// ── Seed safety contract ──────────────────────────────────────────────────
// Before #187 the migrate script skipped shared-lookups.sql entirely whenever
// Finances held user data, so the file's idempotency was a nicety. It is now
// applied unconditionally to the live database on every `docker compose up`,
// which makes it the only thing standing between an edit here and the user's
// records — so the properties it used to merely claim are asserted instead.

export type UnsafeReason =
  | "insert-without-on-conflict"
  | "conflict-not-do-nothing"
  | "unguarded-update"
  | "destructive-statement";

export interface UnsafeStatement {
  reason: UnsafeReason;
  // Best-effort table name; null for statements that do not plainly name one.
  table: string | null;
  // Whitespace-collapsed excerpt of the offending statement, for the CI message.
  snippet: string;
}

// Comments and string literals are removed before scanning so prose (this
// file's own header lists the forbidden keywords) and seeded values (a category
// legitimately named 'Delete') cannot trip the keyword rules. Literals collapse
// to '' rather than vanishing, so the surrounding statement stays parseable.
function scrub(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

function excerpt(statement: string): string {
  const flat = statement.replace(/^;/, "").trim().replace(/\s+/g, " ");
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

// Assert that every statement in the seed is additive and safe to re-run
// against a populated production database:
//
//   * every INSERT carries ON CONFLICT DO NOTHING — a bare INSERT aborts the
//     whole migrate run under `psql -v ON_ERROR_STOP=1` on the second pass, and
//     DO UPDATE overwrites a row the user may have deliberately edited
//   * every UPDATE carries a WHERE guard
//   * no DELETE, TRUNCATE, DROP or ALTER anywhere
//
// SELECT (including setval) is unrestricted. Like parseSeedRows above, this is
// per-statement regex rather than a SQL parser: the seed is hand-authored, flat
// and stable (see #155), and this is a guard-rail against an accidental edit,
// not a sandbox. Returns one entry per violation; empty means the file holds.
export function findUnsafeSeedStatements(sql: string): UnsafeStatement[] {
  const scrubbed = scrub(sql);
  const unsafe: UnsafeStatement[] = [];

  for (const insert of scrubbed.matchAll(/INSERT\s+INTO\s+(\w+)([\s\S]*?)(?=;|$)/gi)) {
    const table = insert[1].toLowerCase();
    const action = /ON\s+CONFLICT\b[\s\S]*?\bDO\s+(\w+)/i.exec(insert[2]);

    if (!action) {
      unsafe.push({ reason: "insert-without-on-conflict", table, snippet: excerpt(insert[0]) });
    } else if (action[1].toUpperCase() !== "NOTHING") {
      unsafe.push({ reason: "conflict-not-do-nothing", table, snippet: excerpt(insert[0]) });
    }
  }

  for (const update of scrubbed.matchAll(/(?:^|;)\s*UPDATE\s+(\w+)([\s\S]*?)(?=;|$)/gi)) {
    if (!/\bWHERE\b/i.test(update[2])) {
      unsafe.push({
        reason: "unguarded-update",
        table: update[1].toLowerCase(),
        snippet: excerpt(update[0]),
      });
    }
  }

  for (const destructive of scrubbed.matchAll(
    /(?:^|;)\s*(?:DELETE|TRUNCATE|DROP|ALTER)\b([\s\S]*?)(?=;|$)/gi,
  )) {
    unsafe.push({ reason: "destructive-statement", table: null, snippet: excerpt(destructive[0]) });
  }

  return unsafe;
}
