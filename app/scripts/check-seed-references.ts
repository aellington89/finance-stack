// CI gate (and `npm run check:seed-references`): asserts every SEED_REFERENCES
// (table, id, name) matches the matching row in init-db/seeds/shared-lookups.sql.
// This catches *code-side* drift the runtime /api/health check cannot — e.g. a
// seed rename "fixed" by editing reference-ids.ts to match, which silences the
// health check while code and seed silently disagree about a clean install.
// Complements #123; see the Issue #155 changelog entry. Mirrors the Schema
// drift gate's ::error:: annotation + remediation-hint style.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SEED_REFERENCES } from "@/lib/constants/reference-ids";
import { findSeedReferenceMismatches, type Mismatch } from "@/scripts/seed-reference-check";

// This file lives at app/scripts/, so ../../ is the repo root.
const SEED_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../init-db/seeds/shared-lookups.sql",
);

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

function main(): void {
  const mismatches = findSeedReferenceMismatches(SEED_REFERENCES, readFileSync(SEED_PATH, "utf8"));

  if (mismatches.length === 0) {
    console.log("✓ Seed reference gate: SEED_REFERENCES matches init-db/seeds/shared-lookups.sql");
    return;
  }

  for (const m of mismatches) console.error(formatMismatch(m));
  console.error("");
  console.error(
    "code-side and seed-side reference data diverged. Reconcile init-db/seeds/shared-lookups.sql " +
      "and app/lib/constants/reference-ids.ts so each (id, name) agrees, then re-run " +
      "`npm run check:seed-references`.",
  );
  process.exit(1);
}

main();
