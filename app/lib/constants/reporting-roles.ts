// What a transaction category *means* to the reporting layer (issue #111).
//
// ── Why this exists ──────────────────────────────────────────────────────
//
// The Liabilities drilldown used to name the categories it aggregates by id,
// in liability-categories.ts. Those rows are the user's — whether you carry a
// HELOC is your business — so pinning them put them in the one cell the
// seed-data taxonomy in docs/database.md calls a defect rather than a
// category: user data that code hard-depends on. The consequences were real
// and documented. A fresh install reported zeros, because none of those ids
// exist there. A user who added "Personal Loan Principle" was silently left
// out of Debt Service and the Debt Waterfall.
//
// Shipping the rows was rejected: it would bake one person's loan portfolio
// into every install and *still* need a code change to extend. So the meaning
// moves off the row's identity and onto an attribute the row can opt into.
// "This category is paid principal on a liability" is an application concept;
// which categories carry it is the user's call.
//
// ── Why a registry rather than a bare union ──────────────────────────────
//
// Every consumer reads this list rather than spelling a role itself: the query
// layer (lib/queries/liabilities-drilldown.ts), the settings UI, the CI gate in
// scripts/seed-reference-check.ts, and the docs recipe in docs/database.md.
// Adding a role is one entry here plus one migration widening the CHECK — and
// nothing else has to be found and edited.
//
// ── Why the keys are namespaced ──────────────────────────────────────────
//
// `debt_principle_paid`, not `principle_paid`. The column is `reporting_role`
// rather than `liability_role` because nothing about the mechanism is
// liability-specific, and future metrics will want roles of their own —
// interest earned, dividends, contributions. Namespacing by domain means those
// arrive as new keys rather than as a collision or a rename, and it keeps a
// role's domain readable at the call site where the group constants are used.
//
// Only the `debt` domain ships today, deliberately: an asset role no query
// reads would be a value in a CHECK constraint that nothing means. See
// "Adding a reporting role" in docs/database.md.
//
// ── The set is written twice, and gated ──────────────────────────────────
//
// These keys also appear in the CHECK constraint on transaction_categories in
// drizzle/schema.ts. Generating one from the other would need sql.raw, which
// eslint.config.mjs bans repo-wide (docs/input-validation.md treats that ban as
// absolute rather than a rule with exceptions), so `npm run
// check:seed-references` proves the two equal in both directions instead —
// the same posture SHIPPED_ROWS has against shared-lookups.sql.

export type ReportingRoleDomain = "debt";

export interface ReportingRole {
  /** Stored in transaction_categories.reporting_role. Namespaced by domain. */
  key: string;
  domain: ReportingRoleDomain;
  /** Shown in the /settings/categories role picker. */
  label: string;
  /** Hover/description text — what tagging a category with this role does. */
  description: string;
}

export const REPORTING_ROLES = [
  {
    key: "debt_principle_paid",
    domain: "debt",
    label: "Debt — principal paid",
    description:
      "The principal portion of a loan payment, posted on the liability account. Counts toward Debt Service payments.",
  },
  {
    key: "debt_interest_paid",
    domain: "debt",
    label: "Debt — interest paid",
    description:
      "The interest portion of a loan payment, posted on the liability account. Counts toward Debt Service payments.",
  },
  {
    key: "debt_interest_accrued",
    domain: "debt",
    label: "Debt — interest accrued",
    description:
      "Interest charged to the balance rather than paid — accrued loan interest, or a credit-card finance charge. Adds to the debt.",
  },
  {
    key: "debt_cash_paydown",
    domain: "debt",
    label: "Debt — cash paydown",
    description:
      "A payment that reduces the balance without splitting into principal and interest, such as a credit-card applied credit.",
  },
] as const satisfies ReadonlyArray<ReportingRole>;

export type ReportingRoleKey = (typeof REPORTING_ROLES)[number]["key"];

export const REPORTING_ROLE_KEYS: ReadonlyArray<ReportingRoleKey> =
  REPORTING_ROLES.map((role) => role.key);

const BY_KEY: ReadonlyMap<string, ReportingRole> = new Map(
  REPORTING_ROLES.map((role) => [role.key, role]),
);

/** The role's declaration, or null when the value is not one this build knows. */
export function reportingRole(key: string | null | undefined): ReportingRole | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/** Narrowing guard for values arriving from a form or the database. */
export function isReportingRoleKey(value: unknown): value is ReportingRoleKey {
  return typeof value === "string" && BY_KEY.has(value);
}

// ── Query-side groups ─────────────────────────────────────────────────────
//
// The two buckets getDebtServiceSummary and getDebtWaterfall aggregate on.
// Four roles rather than two so the split survives in the data, but the
// arithmetic is unchanged from the pinned-id era on purpose: `payments` sums
// all three paid legs and `principalPaid` stays `payments + interestAccrued`,
// so no number on the Liabilities tab moved when this landed.
//
// The finer split does make the exact form — principal paid plus cash paydown,
// without relying on paid interest offsetting accrued interest over the period
// — a one-line change if it is ever wanted. That is deliberately not taken
// here, because it would shift the reported totals.

export const DEBT_PAYMENT_ROLES: ReadonlyArray<ReportingRoleKey> = [
  "debt_principle_paid",
  "debt_interest_paid",
  "debt_cash_paydown",
];

export const DEBT_ACCRUAL_ROLES: ReadonlyArray<ReportingRoleKey> = [
  "debt_interest_accrued",
];

/** Every role the debt aggregates read, payments and accruals together. */
export const DEBT_SERVICE_ROLES: ReadonlyArray<ReportingRoleKey> = [
  ...DEBT_PAYMENT_ROLES,
  ...DEBT_ACCRUAL_ROLES,
];
