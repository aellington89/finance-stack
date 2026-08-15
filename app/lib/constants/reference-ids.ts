// Centralized seed-row references. Each constant pairs the row's primary key
// with the canonical name shipped in init-db/seeds/shared-lookups.sql so the
// /api/health route can verify the DB still matches by name (not just by ID).
// Renaming a referenced row in the DB will trip the drift check.

// ── transaction_types (seeded in init-db/seeds/shared-lookups.sql:27-41) ──

export const EXPENSE_TYPE = { id: 2, name: "Expense" } as const;
export const INCOME_TYPE = { id: 4, name: "Income" } as const;
export const WORK_EXPENSE_TYPE = { id: 5, name: "Work Expense" } as const;
export const WORK_EXPENSE_REIMBURSEMENT_TYPE = {
  id: 6,
  name: "Work Expense Reimbursement",
} as const;
export const INVESTMENT_TYPE = { id: 10, name: "Investment" } as const;
export const OPENING_BALANCE_TYPE = { id: 12, name: "Opening Balance" } as const;

// ── account_type_categories (seeded in init-db/seeds/shared-lookups.sql:17-25) ──

export const RESTRICTED_ASSET_CATEGORY = {
  id: 2,
  name: "Restricted Asset",
} as const;
export const CURRENT_LIABILITY_CATEGORY = {
  id: 5,
  name: "Current Liability",
} as const;
export const NON_CURRENT_LIABILITY_CATEGORY = {
  id: 6,
  name: "Non-current Liability",
} as const;

// ── transaction_categories (seeded in init-db/seeds/shared-lookups.sql) ───
// The one app-owned row in an otherwise user-managed table: account.ts writes
// it on every account created with an initial balance, so it has to exist
// before the user has created anything. It ships in the shared seed as of
// issue #178 — until then it was asserted here but seeded nowhere, so a
// brand-new Finances reported drift on a correct install.
//
// Protected against rename and delete via /settings/categories as of issue
// #109 — it is in SHIPPED_ROWS below. The seed stays ON CONFLICT DO NOTHING,
// so an install that renamed this row before #109 landed keeps its name; the
// protection rule is "the name must equal the shipped name", which means the
// UI still offers the rename that puts it back and refuses every other one.
// The alternative was a seed that silently overwrites a user's edit on every
// `docker compose up`.
//
// Nothing else from this table belongs here; see the seed-data taxonomy in
// docs/database.md.

export const OPENING_BALANCE_CATEGORY = { id: 6, name: "Other" } as const;

// ── Health-check driver ───────────────────────────────────────────────────
// Each entry: which seed table to query and the rows we expect to find there
// by (id, name). The /api/health route iterates this list once per request.

export interface SeedReferenceGroup {
  table: string;
  idColumn: string;
  nameColumn: string;
  expected: ReadonlyArray<{ id: number; name: string }>;
}

// ── Two constants, two questions ──────────────────────────────────────────
//
// SEED_REFERENCES answers "does code depend on this specific row?" — it drives
// /api/health/seed-data, and a row belongs in it only if something in the
// codebase names that id.
//
// SHIPPED_ROWS answers "does this row ship with the application?" — it is the
// full contents of init-db/seeds/shared-lookups.sql, and it is what
// lib/constants/protected-rows.ts locks against edit and delete. Shipping is
// the lock criterion, not being named: transaction_types id 3 'Refund' is
// nobody's constant, but it arrives identically on every install and a user
// renaming it puts their database out of step with every other one for no
// benefit.
//
// SEED_REFERENCES is therefore a subset of SHIPPED_ROWS (asserted in
// tests/unit/lib/constants/protected-rows.test.ts), and the two are kept
// separate rather than merged because widening SEED_REFERENCES would both
// misstate the taxonomy in docs/database.md and grow the health check's
// surface to rows whose names nothing actually reads.
//
// SHIPPED_ROWS duplicates shared-lookups.sql, which is exactly the kind of
// restatement issue #178 was written about — so `npm run check:seed-references`
// proves the two equal in both directions on every PR (issue #109). Add a row
// to that seed without adding it here and the gate fails.

export const SEED_REFERENCES: ReadonlyArray<SeedReferenceGroup> = [
  {
    table: "transaction_types",
    idColumn: "transaction_type_id",
    nameColumn: "transaction_type",
    expected: [
      EXPENSE_TYPE,
      INCOME_TYPE,
      WORK_EXPENSE_TYPE,
      WORK_EXPENSE_REIMBURSEMENT_TYPE,
      INVESTMENT_TYPE,
      OPENING_BALANCE_TYPE,
    ],
  },
  {
    table: "account_type_categories",
    idColumn: "account_type_category_id",
    nameColumn: "account_type_category",
    expected: [
      RESTRICTED_ASSET_CATEGORY,
      CURRENT_LIABILITY_CATEGORY,
      NON_CURRENT_LIABILITY_CATEGORY,
    ],
  },
  {
    table: "transaction_categories",
    idColumn: "transaction_category_id",
    nameColumn: "transaction_category",
    expected: [OPENING_BALANCE_CATEGORY],
  },
];

// ── Protection driver ─────────────────────────────────────────────────────
// Every row init-db/seeds/shared-lookups.sql ships, in seed order. The rows
// that also have a named constant above reuse it, so a rename has one spelling
// to change rather than two.

export const SHIPPED_ROWS: ReadonlyArray<SeedReferenceGroup> = [
  {
    table: "transaction_types",
    idColumn: "transaction_type_id",
    nameColumn: "transaction_type",
    expected: [
      { id: 1, name: "Internal Transfer" },
      EXPENSE_TYPE,
      { id: 3, name: "Refund" },
      INCOME_TYPE,
      WORK_EXPENSE_TYPE,
      WORK_EXPENSE_REIMBURSEMENT_TYPE,
      { id: 7, name: "Other" },
      { id: 8, name: "External Transfer" },
      // "Amoritized" is misspelled in the seed and in production. Corrected
      // here alone it would fail the shipped-set gate, so it stays as shipped
      // until seed, fixture and constant move together — issue #271.
      { id: 9, name: "Accrued Amoritized Interest" },
      INVESTMENT_TYPE,
      { id: 11, name: "Asset Re-Evaluation" },
      OPENING_BALANCE_TYPE,
    ],
  },
  {
    table: "account_type_categories",
    idColumn: "account_type_category_id",
    nameColumn: "account_type_category",
    expected: [
      { id: 1, name: "Current Asset" },
      RESTRICTED_ASSET_CATEGORY,
      { id: 3, name: "Fixed Asset" },
      { id: 4, name: "Investment" },
      CURRENT_LIABILITY_CATEGORY,
      NON_CURRENT_LIABILITY_CATEGORY,
    ],
  },
  {
    table: "transaction_categories",
    idColumn: "transaction_category_id",
    nameColumn: "transaction_category",
    expected: [OPENING_BALANCE_CATEGORY],
  },
];
