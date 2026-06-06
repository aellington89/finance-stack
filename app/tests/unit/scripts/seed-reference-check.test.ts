import { describe, it, expect } from "vitest";
import type { SeedReferenceGroup } from "@/lib/constants/reference-ids";
import {
  parseSeedRows,
  findSeedReferenceMismatches,
  TABLES_ALLOWED_ABSENT,
} from "@/scripts/seed-reference-check";

// A representative slice of shared-lookups.sql: two INSERT blocks plus the
// trailing setval/UPDATE noise the parser must ignore.
const SEED = `
INSERT INTO account_type_categories (account_type_category_id, account_type_category)
OVERRIDING SYSTEM VALUE VALUES
    (1, 'Current Asset'),
    (2, 'Restricted Asset'),
    (5, 'Current Liability')
ON CONFLICT (account_type_category_id) DO NOTHING;

INSERT INTO transaction_types (transaction_type_id, transaction_type)
OVERRIDING SYSTEM VALUE VALUES
    (2, 'Expense'),
    (12, 'Opening Balance')
ON CONFLICT (transaction_type_id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('transaction_types', 'transaction_type_id'), 12);

UPDATE account_types SET liquidity_class = 'liquid'
    WHERE liquidity_class IS NULL AND account_type IN ('Checking Account', 'Savings Account');
`;

// Minimal SeedReferenceGroup factory — the gate only reads `table` and `expected`.
function group(table: string, expected: Array<{ id: number; name: string }>): SeedReferenceGroup {
  return { table, idColumn: "id", nameColumn: "name", expected };
}

describe("parseSeedRows", () => {
  it("parses each INSERT block into table -> (id -> name)", () => {
    const seed = parseSeedRows(SEED);
    expect(seed.get("transaction_types")?.get(2)).toBe("Expense");
    expect(seed.get("transaction_types")?.get(12)).toBe("Opening Balance");
    expect([...(seed.get("account_type_categories")?.keys() ?? [])]).toEqual([1, 2, 5]);
  });

  it("ignores UPDATE and SELECT setval statements", () => {
    const seed = parseSeedRows(SEED);
    expect([...seed.keys()].sort()).toEqual(["account_type_categories", "transaction_types"]);
  });

  it("unescapes doubled single quotes in names", () => {
    const seed = parseSeedRows(
      `INSERT INTO t (id, name) VALUES (1, 'Children''s Fund') ON CONFLICT DO NOTHING;`,
    );
    expect(seed.get("t")?.get(1)).toBe("Children's Fund");
  });
});

describe("findSeedReferenceMismatches", () => {
  it("returns no mismatches when code matches the seed", () => {
    const refs = [
      group("account_type_categories", [{ id: 2, name: "Restricted Asset" }]),
      group("transaction_types", [{ id: 12, name: "Opening Balance" }]),
    ];
    expect(findSeedReferenceMismatches(refs, SEED)).toEqual([]);
  });

  it("treats unreferenced seed rows as fine (directional)", () => {
    // SEED has ids 1 and 5 in account_type_categories that no constant references.
    const refs = [group("account_type_categories", [{ id: 2, name: "Restricted Asset" }])];
    expect(findSeedReferenceMismatches(refs, SEED)).toEqual([]);
  });

  it("flags a renamed row — the deliberate code/seed-disagree case", () => {
    const refs = [group("transaction_types", [{ id: 2, name: "Expenses" }])];
    expect(findSeedReferenceMismatches(refs, SEED)).toEqual([
      { table: "transaction_types", id: 2, expected: "Expenses", actual: "Expense", reason: "name" },
    ]);
  });

  it("flags a referenced id with no matching seed row", () => {
    const refs = [group("transaction_types", [{ id: 99, name: "Nonexistent" }])];
    expect(findSeedReferenceMismatches(refs, SEED)).toEqual([
      { table: "transaction_types", id: 99, expected: "Nonexistent", actual: null, reason: "missing-row" },
    ]);
  });

  it("skips a table that is intentionally absent from shared-lookups.sql", () => {
    expect(TABLES_ALLOWED_ABSENT.has("transaction_categories")).toBe(true);
    const refs = [group("transaction_categories", [{ id: 6, name: "Other" }])];
    expect(findSeedReferenceMismatches(refs, SEED)).toEqual([]);
  });

  it("fails closed when a referenced table is missing and not allowlisted", () => {
    // transaction_types block removed from the seed; the constant still references it.
    const seedWithoutTxTypes = `
INSERT INTO account_type_categories (account_type_category_id, account_type_category)
OVERRIDING SYSTEM VALUE VALUES (2, 'Restricted Asset')
ON CONFLICT (account_type_category_id) DO NOTHING;`;
    const refs = [group("transaction_types", [{ id: 2, name: "Expense" }])];
    expect(findSeedReferenceMismatches(refs, seedWithoutTxTypes)).toEqual([
      { table: "transaction_types", id: null, expected: null, actual: null, reason: "missing-table" },
    ]);
  });
});
