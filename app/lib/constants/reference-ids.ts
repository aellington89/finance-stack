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

// ── transaction_categories ────────────────────────────────────────────────
// One seed-treated row used by account.ts opening-balance logic. NOTE: "Other"
// is canonical for category id=6. Renaming it via /settings/categories will
// intentionally trip the /api/health drift check.

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
