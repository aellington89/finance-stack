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
// 3. The Finances_Test fixture holds every transaction_categories row the
//    Liabilities queries pin, and the integration setup hook does not define a
//    fourth version of them (issue #178).
//
// Mirrors the Schema drift gate's ::error:: annotation + remediation-hint style.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SEED_REFERENCES } from "@/lib/constants/reference-ids";
import {
  DEBT_INTEREST_CATEGORIES,
  DEBT_PAYMENT_CATEGORIES,
} from "@/lib/queries/liability-categories";
import {
  findFixtureGaps,
  findSeedReferenceMismatches,
  findUnsafeSeedStatements,
  type FixtureGap,
  type Mismatch,
  type UnsafeStatement,
} from "@/scripts/seed-reference-check";

// This file lives at app/scripts/, so ../../ is the repo root.
const repoPath = (rel: string) =>
  resolve(dirname(fileURLToPath(import.meta.url)), "../../", rel);

const SEED_PATH = repoPath("init-db/seeds/shared-lookups.sql");
const FIXTURE_PATH = repoPath("init-db/seeds/finances-test-mock-data.sql");
const SETUP_PATH = repoPath("app/tests/integration/vitest-setup.ts");

function formatMismatch(m: Mismatch): string {
  switch (m.reason) {
    case "name":
      return `::error::Seed reference drift: ${m.table} id=${m.id} — code expects "${m.expected}" but shared-lookups.sql has "${m.actual}"`;
    case "missing-row":
      return `::error::Seed reference drift: ${m.table} id=${m.id} — code expects "${m.expected}" but no row with that id exists in shared-lookups.sql`;
    case "missing-table":
      return `::error::Seed reference drift: table "${m.table}" is referenced by SEED_REFERENCES but no INSERT block exists in shared-lookups.sql (and it is not in the allowed-absent list)`;
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

function formatFixtureGap(g: FixtureGap): string {
  const fixture = "init-db/seeds/finances-test-mock-data.sql";
  switch (g.reason) {
    case "pin-missing":
      return `::error::Fixture gap: transaction_categories id=${g.id} "${g.expected}" is pinned by app/lib/queries/liability-categories.ts but no row with that id exists in ${fixture}`;
    case "pin-name":
      return `::error::Fixture gap: transaction_categories id=${g.id} — liability-categories.ts pins "${g.expected}" but ${fixture} has "${g.actual}"`;
    case "setup-missing":
      return `::error::Fixture gap: transaction_categories id=${g.id} "${g.expected}" is upserted by app/tests/integration/vitest-setup.ts but is absent from ${fixture}`;
    case "setup-name":
      return `::error::Fixture gap: transaction_categories id=${g.id} — vitest-setup.ts upserts "${g.expected}" but ${fixture} has "${g.actual}"`;
  }
}

function main(): void {
  const seed = readFileSync(SEED_PATH, "utf8");
  const mismatches = findSeedReferenceMismatches(SEED_REFERENCES, seed);
  const unsafe = findUnsafeSeedStatements(seed);
  const gaps = findFixtureGaps(
    [...DEBT_PAYMENT_CATEGORIES, ...DEBT_INTEREST_CATEGORIES],
    readFileSync(FIXTURE_PATH, "utf8"),
    readFileSync(SETUP_PATH, "utf8"),
  );

  if (mismatches.length > 0) {
    for (const m of mismatches) console.error(formatMismatch(m));
    console.error("");
    console.error(
      "code-side and seed-side reference data diverged. Reconcile init-db/seeds/shared-lookups.sql " +
        "and app/lib/constants/reference-ids.ts so each (id, name) agrees, then re-run " +
        "`npm run check:seed-references`.",
    );
  }

  if (unsafe.length > 0) {
    if (mismatches.length > 0) console.error("");
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
    if (mismatches.length > 0 || unsafe.length > 0) console.error("");
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

  if (mismatches.length > 0 || unsafe.length > 0 || gaps.length > 0) process.exit(1);

  console.log("✓ Seed reference gate: SEED_REFERENCES matches init-db/seeds/shared-lookups.sql");
  console.log("✓ Seed contract gate: every statement in shared-lookups.sql is additive and re-runnable");
  console.log("✓ Fixture agreement gate: finances-test-mock-data.sql holds every pinned liability category, and vitest-setup.ts agrees with it");
}

main();
