// The account_type_category ids that make an account a liability.
//
// These are pinned by id and that is correct: account_type_categories ships
// with the application in init-db/seeds/shared-lookups.sql, arrives identical
// on every install, and is protected against rename and delete (issue #109).
// Under the seed-data taxonomy in docs/database.md that is app-owned reference
// data — the bucket where code depending on a specific row is legitimate.
//
// ── What used to live here ───────────────────────────────────────────────
//
// Until issue #111 this module also held two lists of literal
// transaction_category_id values naming the categories the Debt Service and
// Debt Waterfall aggregates read: DEBT_PAYMENT_CATEGORIES and
// DEBT_INTEREST_CATEGORIES, fifteen rows between them, pinned by id and name.
//
// Those rows were the user's. Whether you carry a HELOC is your business, and
// they ship nowhere — so the pins put them in the one cell the taxonomy calls a
// defect rather than a category: user data that code hard-depends on. A fresh
// install reported zeros across the Liabilities tab because none of those ids
// existed in it, and a user who added "Personal Loan Principle" was silently
// left out of the totals with no error and no way to opt in short of a code
// change.
//
// They are gone. transaction_categories.reporting_role carries the meaning now,
// the queries filter on it at query time, and the set is whatever the user has
// tagged — see lib/constants/reporting-roles.ts.

import {
  CURRENT_LIABILITY_CATEGORY,
  NON_CURRENT_LIABILITY_CATEGORY,
} from "@/lib/constants/reference-ids";

export const LIABILITY_CURRENT_CATEGORY_ID = CURRENT_LIABILITY_CATEGORY.id;
export const LIABILITY_NON_CURRENT_CATEGORY_ID = NON_CURRENT_LIABILITY_CATEGORY.id;

export const LIABILITY_CATEGORY_IDS = [
  LIABILITY_CURRENT_CATEGORY_ID,
  LIABILITY_NON_CURRENT_CATEGORY_ID,
] as const;
