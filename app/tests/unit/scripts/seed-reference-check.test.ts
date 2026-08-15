import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedReferenceGroup } from "@/lib/constants/reference-ids";
import {
  DEBT_INTEREST_CATEGORIES,
  DEBT_PAYMENT_CATEGORIES,
} from "@/lib/queries/liability-categories";
import {
  parseSeedRows,
  findFixtureGaps,
  findSeedReferenceMismatches,
  findShippedSetMismatches,
  findUnsafeSeedStatements,
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

  // The allowlist is empty as shipped (issue #178 retired its only member,
  // transaction_categories, by seeding id 6 'Other' in shared-lookups.sql), so
  // the mechanism has to be exercised against a synthetic entry or it would
  // sit here untested until the next time someone needs it.
  it("is shipped with an empty allowlist — an absent table is a defect, not a config", () => {
    expect([...TABLES_ALLOWED_ABSENT]).toEqual([]);
  });

  it("skips a table that is intentionally absent from shared-lookups.sql", () => {
    const refs = [group("user_preferences", [{ id: 1, name: "Theme" }])];
    expect(findSeedReferenceMismatches(refs, SEED)).toEqual([
      { table: "user_preferences", id: null, expected: null, actual: null, reason: "missing-table" },
    ]);

    TABLES_ALLOWED_ABSENT.add("user_preferences");
    try {
      expect(findSeedReferenceMismatches(refs, SEED)).toEqual([]);
    } finally {
      TABLES_ALLOWED_ABSENT.delete("user_preferences");
    }
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

// The seed is applied to the live Finances database on every migrate run
// (issue #187), so these rules are what stands between an edit to that file and
// real user data.
describe("findShippedSetMismatches", () => {
  // The full contents of SEED above, which is what a correct SHIPPED_ROWS
  // looks like for this fixture.
  const complete = [
    group("account_type_categories", [
      { id: 1, name: "Current Asset" },
      { id: 2, name: "Restricted Asset" },
      { id: 5, name: "Current Liability" },
    ]),
    group("transaction_types", [
      { id: 2, name: "Expense" },
      { id: 12, name: "Opening Balance" },
    ]),
  ];

  it("passes when code and seed hold exactly the same rows", () => {
    expect(findShippedSetMismatches(complete, SEED)).toEqual([]);
  });

  it("flags a seed row the code does not declare", () => {
    // The asymmetry that matters: this row ships to every install and, without
    // a SHIPPED_ROWS entry, arrives editable.
    const missingOne = [
      complete[0],
      group("transaction_types", [{ id: 2, name: "Expense" }]),
    ];
    expect(findShippedSetMismatches(missingOne, SEED)).toEqual([
      {
        table: "transaction_types",
        id: 12,
        expected: null,
        actual: "Opening Balance",
        reason: "unlisted",
      },
    ]);
  });

  it("flags a whole table the code does not declare", () => {
    const typesOnly = [complete[1]];
    expect(findShippedSetMismatches(typesOnly, SEED)).toEqual([
      { table: "account_type_categories", id: 1, expected: null, actual: "Current Asset", reason: "unlisted" },
      { table: "account_type_categories", id: 2, expected: null, actual: "Restricted Asset", reason: "unlisted" },
      { table: "account_type_categories", id: 5, expected: null, actual: "Current Liability", reason: "unlisted" },
    ]);
  });

  it("flags a declared row the seed does not ship", () => {
    const extra = [
      complete[0],
      group("transaction_types", [
        { id: 2, name: "Expense" },
        { id: 12, name: "Opening Balance" },
        { id: 13, name: "Invented" },
      ]),
    ];
    expect(findShippedSetMismatches(extra, SEED)).toEqual([
      { table: "transaction_types", id: 13, expected: "Invented", actual: null, reason: "missing-row" },
    ]);
  });

  it("flags a name disagreement once, not twice", () => {
    // The code->seed pass reports the name; the seed->code pass must not then
    // also report the same id as unlisted.
    const renamed = [
      complete[0],
      group("transaction_types", [
        { id: 2, name: "Expense" },
        { id: 12, name: "Opening Balances" },
      ]),
    ];
    expect(findShippedSetMismatches(renamed, SEED)).toEqual([
      { table: "transaction_types", id: 12, expected: "Opening Balances", actual: "Opening Balance", reason: "name" },
    ]);
  });

  it("flags a declared table with no INSERT block at all", () => {
    const withGhost = [...complete, group("ghost_table", [{ id: 1, name: "Nothing" }])];
    expect(findShippedSetMismatches(withGhost, SEED)).toEqual([
      { table: "ghost_table", id: null, expected: null, actual: null, reason: "missing-table" },
    ]);
  });

  it("does not honour TABLES_ALLOWED_ABSENT", () => {
    // That escape hatch belongs to the reference check. A shipped row is
    // shipped; there is no "declared but deliberately unseeded" case here.
    expect(TABLES_ALLOWED_ABSENT.size).toBe(0);
    const withGhost = [group("ghost_table", [{ id: 1, name: "Nothing" }])];
    expect(findShippedSetMismatches(withGhost, SEED).some((m) => m.reason === "missing-table")).toBe(
      true
    );
  });
});

describe("findUnsafeSeedStatements", () => {
  const reasons = (sql: string) => findUnsafeSeedStatements(sql).map((u) => u.reason);

  it("accepts the representative slice: DO NOTHING inserts, setval, guarded UPDATE", () => {
    expect(findUnsafeSeedStatements(SEED)).toEqual([]);
  });

  it("accepts the shipped shared-lookups.sql", () => {
    // The fixture above is a slice; this is the file the migrate service runs.
    const seedPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../init-db/seeds/shared-lookups.sql",
    );
    expect(findUnsafeSeedStatements(readFileSync(seedPath, "utf8"))).toEqual([]);
  });

  it("flags ON CONFLICT DO UPDATE — it overwrites a row the user may have edited", () => {
    const sql = `
INSERT INTO transaction_types (transaction_type_id, transaction_type)
OVERRIDING SYSTEM VALUE VALUES (12, 'Opening Balance')
ON CONFLICT (transaction_type_id) DO UPDATE
  SET transaction_type = EXCLUDED.transaction_type;`;
    expect(findUnsafeSeedStatements(sql)).toEqual([
      {
        reason: "conflict-not-do-nothing",
        table: "transaction_types",
        snippet: expect.stringContaining("INSERT INTO transaction_types"),
      },
    ]);
  });

  it("flags an INSERT with no ON CONFLICT — it aborts the migrate job on re-run", () => {
    const sql = `INSERT INTO transaction_types (transaction_type_id, transaction_type)
      VALUES (13, 'Adjustment');`;
    expect(reasons(sql)).toEqual(["insert-without-on-conflict"]);
  });

  it("flags an UPDATE with no WHERE clause", () => {
    expect(reasons(`UPDATE account_types SET liquidity_class = 'liquid';`)).toEqual([
      "unguarded-update",
    ]);
  });

  it("flags DELETE, TRUNCATE, DROP and ALTER", () => {
    const sql = `
DELETE FROM transaction_types WHERE transaction_type_id = 12;
TRUNCATE account_type_categories;
DROP TABLE transaction_types;
ALTER TABLE account_types ADD COLUMN foo text;`;
    expect(reasons(sql)).toEqual([
      "destructive-statement",
      "destructive-statement",
      "destructive-statement",
      "destructive-statement",
    ]);
  });

  it("does not flag prose in comments that names the forbidden keywords", () => {
    // This file's own header lists DELETE / TRUNCATE / DO UPDATE as forbidden.
    const sql = `
-- Never add a DELETE, a TRUNCATE, or an ON CONFLICT DO UPDATE here.
/* DROP TABLE and ALTER TABLE are likewise out. */
INSERT INTO transaction_types (transaction_type_id, transaction_type)
VALUES (12, 'Opening Balance') ON CONFLICT (transaction_type_id) DO NOTHING;`;
    expect(findUnsafeSeedStatements(sql)).toEqual([]);
  });

  it("does not flag a seeded value that happens to contain a forbidden keyword", () => {
    const sql = `INSERT INTO transaction_categories (transaction_category_id, transaction_category)
VALUES (99, 'Delete') ON CONFLICT (transaction_category_id) DO NOTHING;`;
    expect(findUnsafeSeedStatements(sql)).toEqual([]);
  });

  it("does not flag SELECT setval", () => {
    const sql = `SELECT setval(pg_get_serial_sequence('transaction_types', 'transaction_type_id'), 12);`;
    expect(findUnsafeSeedStatements(sql)).toEqual([]);
  });

  it("reports every violation in a file, not just the first", () => {
    const sql = `
INSERT INTO a (id, name) VALUES (1, 'x') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
UPDATE b SET c = 1;
DELETE FROM d WHERE id = 1;`;
    expect(reasons(sql).sort()).toEqual([
      "conflict-not-do-nothing",
      "destructive-statement",
      "unguarded-update",
    ]);
  });

  it("truncates a long statement in the snippet so CI output stays readable", () => {
    // Long in structure, not in literals — literals are scrubbed to '' before
    // the snippet is taken, so a long string would collapse rather than truncate.
    const assignments = Array.from({ length: 40 }, (_, i) => `col_${i} = ${i}`).join(", ");
    const [violation] = findUnsafeSeedStatements(`UPDATE account_types SET ${assignments};`);
    expect(violation.reason).toBe("unguarded-update");
    expect(violation.snippet.length).toBeLessThanOrEqual(80);
    expect(violation.snippet.endsWith("...")).toBe(true);
  });
});

// The third source-of-truth check (issue #178). transaction_categories is
// defined in three places; the fixture seed is the one the migrate service
// actually applies, so the other two are checked against it.
describe("findFixtureGaps", () => {
  const FIXTURE = `
INSERT INTO transaction_categories (transaction_category_id, transaction_category)
OVERRIDING SYSTEM VALUE VALUES
    (6,  'Other'),
    (7,  'HELOC Principle'),
    (13, 'Mortgage Interest')
ON CONFLICT (transaction_category_id) DO NOTHING;`;

  // vitest-setup.ts writes the same INSERT shape in a template literal, with
  // DO UPDATE rather than DO NOTHING. parseSeedRows reads it unchanged.
  const setup = (rows: string) => `
  await db.execute(sql\`
    INSERT INTO transaction_categories (transaction_category_id, transaction_category)
    OVERRIDING SYSTEM VALUE VALUES
${rows}
    ON CONFLICT (transaction_category_id) DO UPDATE
      SET transaction_category = EXCLUDED.transaction_category
  \`);`;

  const IN_SYNC = setup(`      (6,  'Other'),\n      (7,  'HELOC Principle')`);

  it("returns nothing when the pins and the setup hook both agree with the fixture", () => {
    const pins = [{ id: 7, name: "HELOC Principle" }];
    expect(findFixtureGaps(pins, FIXTURE, IN_SYNC)).toEqual([]);
  });

  it("flags a pinned category the fixture does not provide — the 7/8/75/76 regression", () => {
    const pins = [{ id: 75, name: "Student Loan Principle" }];
    expect(findFixtureGaps(pins, FIXTURE, IN_SYNC)).toEqual([
      { reason: "pin-missing", id: 75, expected: "Student Loan Principle", actual: null },
    ]);
  });

  it("flags a pinned id whose fixture row carries a different name", () => {
    const pins = [{ id: 13, name: "Mortgage Principle" }];
    expect(findFixtureGaps(pins, FIXTURE, IN_SYNC)).toEqual([
      { reason: "pin-name", id: 13, expected: "Mortgage Principle", actual: "Mortgage Interest" },
    ]);
  });

  it("flags a setup-hook row absent from the fixture — the hook must not be a second definition", () => {
    const withExtra = setup(`      (6,  'Other'),\n      (8,  'HELOC Interest')`);
    expect(findFixtureGaps([], FIXTURE, withExtra)).toEqual([
      { reason: "setup-missing", id: 8, expected: "HELOC Interest", actual: null },
    ]);
  });

  it("flags a setup-hook row whose name disagrees with the fixture", () => {
    const renamed = setup(`      (13, 'Mortgage Principle')`);
    expect(findFixtureGaps([], FIXTURE, renamed)).toEqual([
      { reason: "setup-name", id: 13, expected: "Mortgage Principle", actual: "Mortgage Interest" },
    ]);
  });

  it("is directional: a fixture row no test perturbs need not be in the setup hook", () => {
    // 13 is in the fixture and not in IN_SYNC. That is fine.
    expect(findFixtureGaps([], FIXTURE, IN_SYNC)).toEqual([]);
  });

  it("accepts the shipped files", () => {
    const repo = (rel: string) =>
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../", rel), "utf8");
    expect(
      findFixtureGaps(
        [...DEBT_PAYMENT_CATEGORIES, ...DEBT_INTEREST_CATEGORIES],
        repo("init-db/seeds/finances-test-mock-data.sql"),
        repo("app/tests/integration/vitest-setup.ts"),
      ),
    ).toEqual([]);
  });
});
