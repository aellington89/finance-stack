// Pure parse + diff helpers backing the seed-reference CI gate
// (app/scripts/check-seed-references.ts). Kept side-effect-free so the unit
// suite can exercise the logic against inline SQL fixtures without touching the
// filesystem or the process exit code.
//
// The gate is directional: every SEED_REFERENCES (table, id, name) must match
// the matching INSERT row in init-db/seeds/shared-lookups.sql, but unreferenced
// seed rows are fine. It is also fail-closed — a referenced table with no INSERT
// block in the seed trips the gate unless it is intentionally seeded elsewhere
// (see TABLES_ALLOWED_ABSENT).

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
