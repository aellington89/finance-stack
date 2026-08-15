// The role vocabulary (issue #87).
//
// `users.role` has existed since issue #120 with a default of 'admin', and
// nothing was gated on it — docs/auth.md said so in as many words. It was
// pre-wiring for this.
//
// Two roles, not a permission system. `admin` may edit the lookup tables the
// application's KPIs are computed from; `user` may do everything else,
// including the ordinary CRUD on their own transaction categories and account
// types. The split exists because incorrect edits to `account_type_categories`
// or `transaction_types` break balance-sheet groupings and transaction
// classification across every view at once, and that is a different class of
// mistake from renaming a category.
//
// Kept free of `@/auth`, `next/*` and the database so both server guards and
// client-side nav rendering can import it.

export const USER_ROLES = ["admin", "user"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ADMIN_ROLE: UserRole = "admin";
export const DEFAULT_ROLE: UserRole = "admin";

/** Narrowing guard for a value arriving from the database, a CLI flag or a JWT. */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Whether this role may administer the lookup tables.
 *
 * Deliberately fail-closed on anything unrecognised — an absent role, or one
 * from a session minted before the CHECK constraint existed, is not an admin.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === ADMIN_ROLE;
}
