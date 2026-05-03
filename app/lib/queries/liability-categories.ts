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
// SCHEMA LIMITATION: these IDs are hard-coded against the seeded
// transaction_categories rows. If a user adds a custom category for a new
// loan type (e.g. "Personal Loan Principle") via /settings/categories, it
// will not be picked up by the debt-service / waterfall queries. A future
// fix needs a "released"/standard-mapping concept on transaction_categories
// so user-owned rows can opt into these aggregates. Track separately.

export const LIABILITY_CURRENT_CATEGORY_ID = 5;
export const LIABILITY_NON_CURRENT_CATEGORY_ID = 6;

export const LIABILITY_CATEGORY_IDS = [
  LIABILITY_CURRENT_CATEGORY_ID,
  LIABILITY_NON_CURRENT_CATEGORY_ID,
] as const;

// Paid principal + paid interest legs that post to the liability account.
// `principalPaid = totalPayments + interestAccrued` reconciles because the
// paid-interest categories (8/13/68/76) offset the accrued-interest
// categories (9/14/69/74) when summed in the same period.
export const DEBT_PAYMENT_CATEGORY_IDS = [
  7, // HELOC Principle
  8, // HELOC Interest
  12, // Mortgage Principle
  13, // Mortgage Interest
  29, // Applied Credit (credit-card paydown)
  57, // Epic Loan Interest
  68, // Auto Loan Interest
  70, // Auto Loan Principle
  75, // Student Loan Principle
  76, // Student Loan Interest
] as const;

// Interest charges that add to the liability balance (posted negative).
export const DEBT_INTEREST_CATEGORY_IDS = [
  9, // Accrued HELOC Interest
  14, // Accrued Mortgage Interest
  69, // Accrued Auto Loan Interest
  74, // Accrued Student Loan Interest
  80, // Credit Card Interest
] as const;
