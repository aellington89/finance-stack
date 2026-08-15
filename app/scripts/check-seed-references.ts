// CI gate (and `npm run check:seed-references`): three assertions over the
// repo's seed data.
//
// 1. Every SEED_REFERENCES (table, id, name) matches the matching row in
//    init-db/seeds/shared-lookups.sql. This catches *code-side* drift the
//    runtime /api/health check cannot — e.g. a seed rename "fixed" by editing
//    reference-ids.ts to match, which silences the health check while code and
//    seed silently disagree about a clean install. Complements #123; see the
//    Issue #155 changelog entry.
// 2. Every statement in that seed is additive and re-runnable. The migrate
//    service applies this file to the live Finances database unconditionally
//    (issue #187), so a DELETE, a TRUNCATE or an ON CONFLICT DO UPDATE slipped
//    in here would reach real user data on the next `docker compose up`.
// 3. The Finances_Test fixture carries every reporting role the Liabilities
//    queries filter on, and the integration setup hook does not define a
//    fourth version of the fixture rows (issues #178, #111).
// 4. SHIPPED_ROWS lists exactly what that seed ships, in both directions. It is
//    what /settings/categories locks against rename and delete (issue #109), so
//    a seed row missing from it ships to every install editable.
// 5. The reporting-role registry and the CHECK constraint in drizzle/schema.ts
//    hold the same set, in both directions (issue #111).
//
// Plus a structural guard over all three parsed files: no INSERT block may hold
// row groups the parser cannot read, because that failure mode is silent and
// would make checks 1, 3 and 4 pass over an empty set.
//
// Mirrors the Schema drift gate's ::error:: annotation + remediation-hint style.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SEED_REFERENCES, SHIPPED_ROWS } from "@/lib/constants/reference-ids";
import { REPORTING_ROLE_KEYS } from "@/lib/constants/reporting-roles";
import {
  findFixtureGaps,
  findReportingRoleMismatches,
  findSeedReferenceMismatches,
  findShippedSetMismatches,
  findUnparsedSeedBlocks,
  findUnsafeSeedStatements,
  type FixtureGap,
  type Mismatch,
  type RoleSetMismatch,
  type UnparsedBlock,
  type UnsafeStatement,
} from "@/scripts/seed-reference-check";

// This file lives at app/scripts/, so ../../ is the repo root.
const repoPath = (rel: string) =>
  resolve(dirname(fileURLToPath(import.meta.url)), "../../", rel);

const SEED_PATH = repoPath("init-db/seeds/shared-lookups.sql");
const FIXTURE_PATH = repoPath("init-db/seeds/finances-test-mock-data.sql");
const SETUP_PATH = repoPath("app/tests/integration/vitest-setup.ts");
const SCHEMA_PATH = repoPath("app/drizzle/schema.ts");

function formatMismatch(m: Mismatch): string {
  switch (m.reason) {
    case "name":
      return `::error::Seed reference drift: ${m.table} id=${m.id} — code expects "${m.expected}" but shared-lookups.sql has "${m.actual}"`;
    case "missing-row":
      return `::error::Seed reference drift: ${m.table} id=${m.id} — code expects "${m.expected}" but no row with that id exists in shared-lookups.sql`;
    case "missing-table":
      return `::error::Seed reference drift: table "${m.table}" is referenced by SEED_REFERENCES but no INSERT block exists in shared-lookups.sql (and it is not in the allowed-absent list)`;
    case "unlisted":
      // findSeedReferenceMismatches is directional and never emits this — an
      // unreferenced seed row is fine. Only the shipped-set check does.
      return `::error::Seed reference drift: ${m.table} id=${m.id} "${m.actual}" — unexpected reason "unlisted" from the reference check`;
  }
}

function formatShippedMismatch(m: Mismatch): string {
  switch (m.reason) {
    case "name":
      return `::error::Shipped-set drift: ${m.table} id=${m.id} — SHIPPED_ROWS declares "${m.expected}" but shared-lookups.sql ships "${m.actual}"`;
    case "missing-row":
      return `::error::Shipped-set drift: ${m.table} id=${m.id} — SHIPPED_ROWS declares "${m.expected}" but shared-lookups.sql ships no row with that id`;
    case "missing-table":
      return `::error::Shipped-set drift: table "${m.table}" is declared by SHIPPED_ROWS but no INSERT block exists in shared-lookups.sql`;
    case "unlisted":
      return `::error::Shipped-set drift: ${m.table} id=${m.id} "${m.actual}" ships in shared-lookups.sql but is absent from SHIPPED_ROWS — it would reach every install editable`;
  }
}

function formatUnsafe(u: UnsafeStatement): string {
  const where = u.table ? ` on ${u.table}` : "";
  switch (u.reason) {
    case "insert-without-on-conflict":
      return `::error::Seed contract violation${where}: INSERT has no ON CONFLICT clause, so re-running the seed aborts the migrate job — \`${u.snippet}\``;
    case "conflict-not-do-nothing":
      return `::error::Seed contract violation${where}: ON CONFLICT must be DO NOTHING — DO UPDATE overwrites rows in the live Finances database — \`${u.snippet}\``;
    case "unguarded-update":
      return `::error::Seed contract violation${where}: UPDATE has no WHERE clause, so it rewrites every row — \`${u.snippet}\``;
    case "destructive-statement":
      return `::error::Seed contract violation: DELETE / TRUNCATE / DROP / ALTER are not permitted in a seed applied to live data — \`${u.snippet}\``;
  }
}

function formatUnparsed(u: UnparsedBlock): string {
  return `::error::Unreadable seed block: INSERT INTO ${u.table} declares ${u.declared} row group(s) but the parser read ${u.parsed} — the VALUES list must be (<id>, '<name>') tuples and nothing else`;
}

function formatRoleSetMismatch(m: RoleSetMismatch): string {
  switch (m.reason) {
    case "no-constraint":
      return `::error::Reporting-role drift: no transaction_categories_reporting_role_check constraint found in app/drizzle/schema.ts`;
    case "missing-in-schema":
      return `::error::Reporting-role drift: "${m.role}" is declared in app/lib/constants/reporting-roles.ts but absent from the CHECK in app/drizzle/schema.ts — the UI would offer a value the database rejects`;
    case "missing-in-registry":
      return `::error::Reporting-role drift: "${m.role}" is permitted by the CHECK in app/drizzle/schema.ts but absent from app/lib/constants/reporting-roles.ts — the database would accept a value no query reads`;
  }
}

function formatFixtureGap(g: FixtureGap): string {
  const fixture = "init-db/seeds/finances-test-mock-data.sql";
  switch (g.reason) {
    case "role-uncovered":
      return `::error::Fixture gap: no category in ${fixture} carries reporting_role "${g.role}", so any aggregate reading it is indistinguishable from zero in the integration suite`;
    case "setup-missing":
      return `::error::Fixture gap: transaction_categories id=${g.id} "${g.expected}" is upserted by app/tests/integration/vitest-setup.ts but is absent from ${fixture}`;
    case "setup-name":
      return `::error::Fixture gap: transaction_categories id=${g.id} — vitest-setup.ts upserts "${g.expected}" but ${fixture} has "${g.actual}"`;
  }
}

function main(): void {
  const seed = readFileSync(SEED_PATH, "utf8");
  const fixture = readFileSync(FIXTURE_PATH, "utf8");
  const setup = readFileSync(SETUP_PATH, "utf8");

  // Runs first and reports first: every check below reads these files through
  // the same parser, so a block it cannot read makes their success meaningless.
  const unparsed = [seed, fixture, setup].flatMap(findUnparsedSeedBlocks);

  const mismatches = findSeedReferenceMismatches(SEED_REFERENCES, seed);
  const shipped = findShippedSetMismatches(SHIPPED_ROWS, seed);
  const unsafe = findUnsafeSeedStatements(seed);
  const gaps = findFixtureGaps(REPORTING_ROLE_KEYS, fixture, setup);
  const roleSet = findReportingRoleMismatches(
    REPORTING_ROLE_KEYS,
    readFileSync(SCHEMA_PATH, "utf8"),
  );

  if (unparsed.length > 0) {
    for (const u of unparsed) console.error(formatUnparsed(u));
    console.error("");
    console.error(
      "parseSeedRows in app/scripts/seed-reference-check.ts reads `(<id>, '<name>')` tuples and " +
        "nothing else, so a block it cannot read parses to zero rows and every check below passes " +
        "over an empty set while reporting success. Do not widen the INSERT — carry the extra " +
        "column in a separate UPDATE statement, as the reporting_role assignments do.",
    );
    process.exit(1);
  }

  if (mismatches.length > 0) {
    for (const m of mismatches) console.error(formatMismatch(m));
    console.error("");
    console.error(
      "code-side and seed-side reference data diverged. Reconcile init-db/seeds/shared-lookups.sql " +
        "and app/lib/constants/reference-ids.ts so each (id, name) agrees, then re-run " +
        "`npm run check:seed-references`.",
    );
  }

  if (shipped.length > 0) {
    if (mismatches.length > 0) console.error("");
    for (const m of shipped) console.error(formatShippedMismatch(m));
    console.error("");
    console.error(
      "SHIPPED_ROWS in app/lib/constants/reference-ids.ts is the code-side copy of everything " +
        "init-db/seeds/shared-lookups.sql ships, and it is what /settings/categories locks against " +
        "rename and delete (issue #109). Add the row above to SHIPPED_ROWS — it becomes protected — " +
        "or drop it from the seed, then re-run `npm run check:seed-references`.",
    );
  }

  if (unsafe.length > 0) {
    if (mismatches.length > 0 || shipped.length > 0) console.error("");
    for (const u of unsafe) console.error(formatUnsafe(u));
    console.error("");
    console.error(
      "init-db/seeds/shared-lookups.sql is applied to the live Finances database on every " +
        "migrate run, so every statement in it must be additive and safe to re-run (issue #187). " +
        "Rewrite the statements above — see the contract in the file's header — then re-run " +
        "`npm run check:seed-references`.",
    );
  }

  if (gaps.length > 0) {
    if (mismatches.length > 0 || shipped.length > 0 || unsafe.length > 0) console.error("");
    for (const g of gaps) console.error(formatFixtureGap(g));
    console.error("");
    console.error(
      "init-db/seeds/finances-test-mock-data.sql is the source of truth for Finances_Test's " +
        "transaction_categories rows — it is what the migrate service applies. Add the rows above " +
        "to it (do not instead add them to vitest-setup.ts, whose beforeAll upsert is a " +
        "drift-correction for rows tests mutate, not a second definition). See the seed-data " +
        "taxonomy in docs/database.md, then re-run `npm run check:seed-references`.",
    );
  }

  if (roleSet.length > 0) {
    if (mismatches.length > 0 || shipped.length > 0 || unsafe.length > 0 || gaps.length > 0) {
      console.error("");
    }
    for (const m of roleSet) console.error(formatRoleSetMismatch(m));
    console.error("");
    console.error(
      "The reporting-role set is written twice — REPORTING_ROLE_KEYS in " +
        "app/lib/constants/reporting-roles.ts and the CHECK constraint on transaction_categories " +
        "in app/drizzle/schema.ts — because generating one from the other would need sql.raw, " +
        "which eslint.config.mjs bans repo-wide (issue #111). Reconcile the two, run " +
        "`npm run db:generate` so a migration carries the CHECK change, then re-run " +
        "`npm run check:seed-references`.",
    );
  }

  if (
    mismatches.length > 0 ||
    shipped.length > 0 ||
    unsafe.length > 0 ||
    gaps.length > 0 ||
    roleSet.length > 0
  ) {
    process.exit(1);
  }

  console.log("✓ Seed reference gate: SEED_REFERENCES matches init-db/seeds/shared-lookups.sql");
  console.log("✓ Shipped set gate: SHIPPED_ROWS lists exactly what shared-lookups.sql ships, so every shipped row is protected");
  console.log("✓ Seed contract gate: every statement in shared-lookups.sql is additive and re-runnable");
  console.log("✓ Fixture agreement gate: finances-test-mock-data.sql carries every reporting role, and vitest-setup.ts agrees with it");
  console.log("✓ Reporting-role gate: REPORTING_ROLE_KEYS and the transaction_categories CHECK hold the same set");
  console.log("✓ Parser gate: every INSERT block in the three parsed files is readable as (id, 'name') tuples");
}

main();
