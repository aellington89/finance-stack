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

// "unlisted" is used only by findShippedSetMismatches, which unlike the
// reference check runs in both directions: the seed ships a row that
// SHIPPED_ROWS does not declare, so it would reach every install unlocked.
export type MismatchReason = "name" | "missing-row" | "missing-table" | "unlisted";

export interface Mismatch {
  table: string;
  // id/expected are null only for a whole-table miss (reason "missing-table").
  id: number | null;
  expected: string | null;
  // actual is the seed-side name for "name" and "unlisted", and null for
  // "missing-row" / "missing-table".
  actual: string | null;
  reason: MismatchReason;
}

// Parse the `INSERT INTO <table> (...) [OVERRIDING SYSTEM VALUE] VALUES
// (id, 'name'), ... ON CONFLICT ...` blocks from a hand-authored seed file into
// table -> (id -> name). UPDATE / SELECT setval statements carry no
// `VALUES ... ON CONFLICT` and are ignored. Names are single-quoted with SQL ''
// escaping; the seed file is hand-authored and stable, so per-block regex is
// sufficient (see #155).
//
// [\s\S]*? (rather than the `s`/dotAll flag) keeps the multi-line VALUES body
// match compatible with the ES2017 tsconfig target. matchAll clones the regex
// rather than advancing this one's lastIndex, so sharing it across the two
// functions below is safe.
const BLOCK_RE =
  /INSERT\s+INTO\s+(\w+)\s*\([^)]*\)\s*(?:OVERRIDING\s+SYSTEM\s+VALUE\s+)?VALUES\s*([\s\S]*?)\s*ON\s+CONFLICT/gi;

// The 2-tuple contract: exactly `(<integer>, '<name>')`. A third column makes a
// row group stop matching — see findUnparsedSeedBlocks.
const ROW_RE = /\(\s*(\d+)\s*,\s*'((?:[^']|'')*)'\s*\)/g;

export function parseSeedRows(sql: string): Map<string, Map<number, string>> {
  const tables = new Map<string, Map<number, string>>();

  for (const block of sql.matchAll(BLOCK_RE)) {
    const table = block[1].toLowerCase();
    const rows = tables.get(table) ?? new Map<number, string>();
    for (const row of block[2].matchAll(ROW_RE)) {
      rows.set(Number(row[1]), row[2].replace(/''/g, "'"));
    }
    tables.set(table, rows);
  }

  return tables;
}

// ── Parser blind-spot guard ───────────────────────────────────────────────
// parseSeedRows reads `(id, 'name')` and nothing else, which makes its failure
// mode silence rather than noise: give one of these INSERT blocks a third
// column and every row in it stops matching, the block parses to zero rows, and
// each gate built on top — reference agreement, the shipped set, fixture
// agreement — passes over an empty set while reporting success.
//
// That is not hypothetical. Issue #111 needed a reporting_role on
// transaction_categories, and the obvious way to seed it was a third column in
// the fixture's VALUES list, which would have quietly blinded three of the four
// checks in this file. Roles are applied by separate UPDATE statements instead,
// and this guard is what makes that a rule rather than a thing someone
// remembered once.
//
// Counting is done after blanking string literals, so a parenthesis inside a
// category name cannot be mistaken for the start of a row group.
//
// Scoped to the three lookup tables whose parsed rows a gate actually reads.
// The seed files also insert into account_types, accounts and transactions with
// four to seven columns apiece, and parseSeedRows has always returned nothing
// for those — harmlessly, because nothing looks them up. Flagging them would be
// a false positive that trains people to ignore this check, which is the one
// outcome worse than not having it.

export const PARSED_TABLES: ReadonlySet<string> = new Set([
  "transaction_categories",
  "transaction_types",
  "account_type_categories",
]);

export interface UnparsedBlock {
  table: string;
  /** Row groups present in the VALUES body. */
  declared: number;
  /** Rows parseSeedRows actually read out of it. */
  parsed: number;
}

function countRowGroups(valuesBody: string): number {
  const withoutLiterals = valuesBody.replace(/'(?:[^']|'')*'/g, "''");
  return (withoutLiterals.match(/\(/g) ?? []).length;
}

/**
 * One entry per gate-relevant INSERT block whose VALUES body holds row groups
 * parseSeedRows could not read. Empty means every such block matches the
 * 2-tuple contract.
 */
export function findUnparsedSeedBlocks(sql: string): UnparsedBlock[] {
  const unparsed: UnparsedBlock[] = [];

  for (const block of sql.matchAll(BLOCK_RE)) {
    const table = block[1].toLowerCase();
    if (!PARSED_TABLES.has(table)) continue;

    const declared = countRowGroups(block[2]);
    const parsed = [...block[2].matchAll(ROW_RE)].length;

    if (declared !== parsed) {
      unparsed.push({ table, declared, parsed });
    }
  }

  return unparsed;
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

// ── Shipped-set agreement ─────────────────────────────────────────────────
// The fourth half of the gate (issue #109). SHIPPED_ROWS in reference-ids.ts
// is the code-side copy of everything shared-lookups.sql ships, and it is what
// /settings/categories locks against rename and delete. Restating the seed in
// TypeScript is the duplication #178 was written about, so this check proves
// the two equal rather than trusting them to stay so.
//
// Unlike findSeedReferenceMismatches above — deliberately directional, because
// a seed row nothing references is fine — this one runs in BOTH directions. A
// row present in the seed but absent from SHIPPED_ROWS is the dangerous
// asymmetry: it ships to every install and is silently editable, which is the
// bug this gate exists to prevent rather than one it reports after the fact.

export function findShippedSetMismatches(
  shippedRows: ReadonlyArray<SeedReferenceGroup>,
  sql: string,
): Mismatch[] {
  const seed = parseSeedRows(sql);
  const mismatches: Mismatch[] = [];

  // code → seed
  for (const group of shippedRows) {
    const seedRows = seed.get(group.table.toLowerCase());

    if (!seedRows) {
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

  // seed → code. Name disagreements are already reported by the pass above, so
  // this one only looks for rows SHIPPED_ROWS never mentions.
  for (const [table, seedRows] of seed) {
    const group = shippedRows.find((g) => g.table.toLowerCase() === table);
    if (!group) {
      for (const [id, name] of seedRows) {
        mismatches.push({ table, id, expected: null, actual: name, reason: "unlisted" });
      }
      continue;
    }

    const declaredIds = new Set(group.expected.map((r) => r.id));
    for (const [id, name] of seedRows) {
      if (!declaredIds.has(id)) {
        mismatches.push({ table: group.table, id, expected: null, actual: name, reason: "unlisted" });
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
//   * every reporting role the query layer reads must be carried by at least
//     one fixture category, so a test asserting a debt total is asserting over
//     a set that actually contains something;
//   * (3) must be a subset of (2) with matching names — it is what hid the gap,
//     by upserting a superset at test-suite startup.
//
// (3)'s SQL is a template literal in a .ts file, but it is the same
// hand-authored INSERT shape, so parseSeedRows reads it without special-casing.
//
// The first check used to assert that every transaction_category_id pinned by
// liability-categories.ts existed in the fixture under the expected name. Issue
// #111 deleted those pins — the roles replaced them — but the property they
// were protecting outlived them, and is the reason this half exists at all:
// ids 7, 8, 75 and 76 were pinned by shipping queries and missing from the
// fixture for four releases, so the debt-service tests quietly asserted totals
// over a short set. Role coverage is the same guarantee re-expressed against
// what the queries now filter on. A role the fixture never assigns is a role
// whose aggregate no test can distinguish from zero.

export type FixtureGapReason =
  | "role-uncovered"
  | "setup-missing"
  | "setup-name";

export interface FixtureGap {
  reason: FixtureGapReason;
  // Set for "role-uncovered"; null for the setup-* reasons.
  role: string | null;
  // Set for the setup-* reasons; null for "role-uncovered".
  id: number | null;
  expected: string | null;
  // The fixture-side name for "setup-name"; null otherwise.
  actual: string | null;
}

const FIXTURE_TABLE = "transaction_categories";

// Roles are assigned by standalone `UPDATE transaction_categories SET
// reporting_role = '<key>' WHERE ...` statements rather than by a third column
// in the INSERT block, because parseSeedRows reads `(id, 'name')` tuples only —
// see findUnparsedSeedBlocks for what a third column would silently do to every
// other check in this file.
const ROLE_ASSIGNMENT_RE =
  /UPDATE\s+transaction_categories\s+SET\s+reporting_role\s*=\s*'((?:[^']|'')*)'/gi;

export function parseFixtureRoleAssignments(sql: string): Set<string> {
  return new Set(
    [...sql.matchAll(ROLE_ASSIGNMENT_RE)].map((m) => m[1].replace(/''/g, "'")),
  );
}

// roles: every reporting-role key the query layer can filter on.
// fixtureSql / setupSql: finances-test-mock-data.sql and vitest-setup.ts.
export function findFixtureGaps(
  roles: ReadonlyArray<string>,
  fixtureSql: string,
  setupSql: string,
): FixtureGap[] {
  const gaps: FixtureGap[] = [];
  const fixture = parseSeedRows(fixtureSql).get(FIXTURE_TABLE) ?? new Map<number, string>();
  const assigned = parseFixtureRoleAssignments(fixtureSql);

  for (const role of roles) {
    if (!assigned.has(role)) {
      gaps.push({ reason: "role-uncovered", role, id: null, expected: null, actual: null });
    }
  }

  // Directional, like findSeedReferenceMismatches: the fixture may hold rows the
  // setup hook does not bother re-converging, but never the other way round.
  const setup = parseSeedRows(setupSql).get(FIXTURE_TABLE) ?? new Map<number, string>();

  for (const [id, name] of setup) {
    const actual = fixture.get(id);
    if (actual === undefined) {
      gaps.push({ reason: "setup-missing", role: null, id, expected: name, actual: null });
    } else if (actual !== name) {
      gaps.push({ reason: "setup-name", role: null, id, expected: name, actual });
    }
  }

  return gaps;
}

// ── Reporting-role agreement ──────────────────────────────────────────────
// The fifth assertion (issue #111). The set of valid reporting roles is written
// twice and cannot be written once: lib/constants/reporting-roles.ts declares
// it in TypeScript, and drizzle/schema.ts spells it again in the CHECK
// constraint on transaction_categories. Building the second from the first
// would need sql.raw to interpolate the list into the constraint expression,
// and eslint.config.mjs bans sql.raw repo-wide — docs/input-validation.md is
// explicit that the ban is absolute rather than a rule with exceptions, which
// is what lets it be enforced by lint at all.
//
// So the two are proved equal instead, exactly as SHIPPED_ROWS is proved equal
// to shared-lookups.sql. Both directions matter and for different reasons: a
// role in the registry but not the constraint is a value the UI offers and the
// database rejects, and a role in the constraint but not the registry is a
// value the database accepts that no query will ever read.
//
// This gate covers registry -> schema.ts. The CI schema-drift gate carries
// schema.ts -> the applied migrations, and an integration test asserts the live
// database rejects an unknown role, so the chain runs end to end.

export type RoleSetReason = "missing-in-schema" | "missing-in-registry" | "no-constraint";

export interface RoleSetMismatch {
  reason: RoleSetReason;
  /** null only for "no-constraint". */
  role: string | null;
}

const ROLE_CHECK_RE =
  /transaction_categories_reporting_role_check[\s\S]*?ARRAY\s*\[([\s\S]*?)\]/;

export function findReportingRoleMismatches(
  registryKeys: ReadonlyArray<string>,
  schemaTs: string,
): RoleSetMismatch[] {
  const block = ROLE_CHECK_RE.exec(schemaTs);
  if (!block) {
    return [{ reason: "no-constraint", role: null }];
  }

  const schemaRoles = new Set(
    [...block[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")),
  );
  const registry = new Set(registryKeys);
  const mismatches: RoleSetMismatch[] = [];

  for (const role of registry) {
    if (!schemaRoles.has(role)) mismatches.push({ reason: "missing-in-schema", role });
  }
  for (const role of schemaRoles) {
    if (!registry.has(role)) mismatches.push({ reason: "missing-in-registry", role });
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
