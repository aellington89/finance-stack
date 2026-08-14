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

// Escape hatch for a table referenced by SEED_REFERENCES that is deliberately
// NOT in shared-lookups.sql. Empty, and meant to stay that way: issue #178
// settled that "referenced by code but shipped nowhere" is a defect rather than
// a configuration, and transaction_categories — its only ever member — now
// ships its one app-owned row (id 6 'Other') in the shared seed like every
// other reference row. Any absent table is a bug and fails the gate.
export const TABLES_ALLOWED_ABSENT = new Set<string>([]);

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

// ── Fixture agreement ─────────────────────────────────────────────────────
// The third half of the gate (issue #178). transaction_categories has three
// definitions in this repo and they had drifted apart:
//
//   1. init-db/seeds/shared-lookups.sql       — the one app-owned row, id 6
//   2. init-db/seeds/finances-test-mock-data.sql — the Finances_Test fixture
//   3. app/tests/integration/vitest-setup.ts  — a beforeAll upsert that
//      re-converges rows a previous test mutated
//
// (2) is the source of truth for fixture rows, because it is what the migrate
// service actually applies. The two checks below make the other consumers
// agree with it rather than quietly diverging:
//
//   * every ID pinned by liability-categories.ts must exist in (2) with a
//     matching name — ids 7/8/75/76 were pinned by shipping queries and absent
//     from the fixture, so tests asserted debt totals over a short set;
//   * (3) must be a subset of (2) with matching names — it is what hid the gap,
//     by upserting a superset at test-suite startup.
//
// (3)'s SQL is a template literal in a .ts file, but it is the same
// hand-authored INSERT shape, so parseSeedRows reads it without special-casing.

export type FixtureGapReason =
  | "pin-missing"
  | "pin-name"
  | "setup-missing"
  | "setup-name";

export interface FixtureGap {
  reason: FixtureGapReason;
  id: number;
  expected: string;
  // The fixture-side name for a "*-name" gap; null when the row is absent.
  actual: string | null;
}

const FIXTURE_TABLE = "transaction_categories";

// pins: the (id, name) pairs liability-categories.ts filters on.
// fixtureSql / setupSql: finances-test-mock-data.sql and vitest-setup.ts.
export function findFixtureGaps(
  pins: ReadonlyArray<{ id: number; name: string }>,
  fixtureSql: string,
  setupSql: string,
): FixtureGap[] {
  const gaps: FixtureGap[] = [];
  const fixture = parseSeedRows(fixtureSql).get(FIXTURE_TABLE) ?? new Map<number, string>();

  for (const { id, name } of pins) {
    const actual = fixture.get(id);
    if (actual === undefined) {
      gaps.push({ reason: "pin-missing", id, expected: name, actual: null });
    } else if (actual !== name) {
      gaps.push({ reason: "pin-name", id, expected: name, actual });
    }
  }

  // Directional, like findSeedReferenceMismatches: the fixture may hold rows the
  // setup hook does not bother re-converging, but never the other way round.
  const setup = parseSeedRows(setupSql).get(FIXTURE_TABLE) ?? new Map<number, string>();

  for (const [id, name] of setup) {
    const actual = fixture.get(id);
    if (actual === undefined) {
      gaps.push({ reason: "setup-missing", id, expected: name, actual: null });
    } else if (actual !== name) {
      gaps.push({ reason: "setup-name", id, expected: name, actual });
    }
  }

  return gaps;
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
