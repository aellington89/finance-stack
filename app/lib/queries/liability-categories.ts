// Pinned IDs the Liabilities drilldown depends on.
//
// account_type_category_id values come from init-db/seeds/shared-lookups.sql
// and are stable across deployments. transaction_category_id values are
// pinned by ID to the production Finances DB rather than matched by name —
// this avoids fragility from rename/pattern mismatches but means the seeded
// rows must not be deleted via /settings/categories.
//
// Categorization scheme (see docs/Liability Tracking.md):
//   • DEBT_INTEREST_CATEGORY_IDS — interest charges that ADD to the
//     liability balance. Posted on the liability side as a NEGATIVE amount
//     (added debt). Includes the "Accrued *" categories for loans and
//     "Credit Card Interest" finance charges (credit cards don't split into
//     accrued/paid the way installment loans do — the finance charge is the
//     accrual).
//   • DEBT_PAYMENT_CATEGORY_IDS — paid principal/interest expenses on the
//     liability side, plus "Applied Credit" for credit-card paydowns. Posted
//     as POSITIVE on the liability side (paydown). Cash-side "*Payment"
//     categories (1/2/3/4/54/58/79) are intentionally excluded — they only
//     appear on the checking leg and would never match the liability-side
//     WHERE filter.
//
// SCHEMA LIMITATION — and the taxonomy answer for it (issue #178).
//
// These rows are USER DATA that the app reads as if it were app-owned
// reference data, which is the one combination the seed-data taxonomy in
// docs/database.md calls a defect rather than a category. Whether you carry a
// HELOC is yours to decide; "this category is paid principal on a liability"
// is an application concept. Pinning the second to the first means a user who
// adds "Personal Loan Principle" via /settings/categories is silently left out
// of the debt-service / waterfall aggregates, and a fresh install — which has
// none of these rows — reports zeros.
//
// The resolution is #111: a liability_role attribute a user-owned row can opt
// into, replacing these lists entirely. Deliberately NOT resolved by shipping
// these rows in shared-lookups.sql — that would bake one person's loan
// portfolio into every install and still leave the set unextensible without a
// code change. Only id 6 'Other' ships there, because the app writes it
// itself; see that file's header.
//
// Until #111 lands, the names below are load-bearing rather than decorative:
// `npm run check:seed-references` asserts each (id, name) against
// init-db/seeds/finances-test-mock-data.sql, so a pin that no fixture provides
// fails CI instead of silently contributing nothing to a test's totals — which
// is how ids 7, 8, 75 and 76 went four releases missing from that fixture.

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

// One pinned category. `name` is the fixture contract, not documentation: the
// seed-reference gate looks the id up in finances-test-mock-data.sql and fails
// when the name there disagrees.
export interface PinnedCategory {
  id: number;
  name: string;
}

// Paid principal + paid interest legs that post to the liability account.
// `principalPaid = totalPayments + interestAccrued` reconciles because the
// paid-interest categories (8/13/68/76) offset the accrued-interest
// categories (9/14/69/74) when summed in the same period.
export const DEBT_PAYMENT_CATEGORIES: ReadonlyArray<PinnedCategory> = [
  { id: 7, name: "HELOC Principle" },
  { id: 8, name: "HELOC Interest" },
  { id: 12, name: "Mortgage Principle" },
  { id: 13, name: "Mortgage Interest" },
  { id: 29, name: "Applied Credit" }, // credit-card paydown
  { id: 57, name: "Epic Loan Interest" },
  { id: 68, name: "Auto Loan Interest" },
  { id: 70, name: "Auto Loan Principle" },
  { id: 75, name: "Student Loan Principle" },
  { id: 76, name: "Student Loan Interest" },
];

// Interest charges that add to the liability balance (posted negative).
export const DEBT_INTEREST_CATEGORIES: ReadonlyArray<PinnedCategory> = [
  { id: 9, name: "Accrued HELOC Interest" },
  { id: 14, name: "Accrued Mortgage Interest" },
  { id: 69, name: "Accrued Auto Loan Interest" },
  { id: 74, name: "Accrued Student Loan Interest" },
  { id: 80, name: "Credit Card Interest" },
];

// The query layer filters on IDs alone; the names above exist for the gate.
export const DEBT_PAYMENT_CATEGORY_IDS: readonly number[] =
  DEBT_PAYMENT_CATEGORIES.map((c) => c.id);

export const DEBT_INTEREST_CATEGORY_IDS: readonly number[] =
  DEBT_INTEREST_CATEGORIES.map((c) => c.id);
