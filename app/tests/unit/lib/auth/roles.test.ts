import { describe, it, expect } from "vitest";

import {
  ADMIN_ROLE,
  DEFAULT_ROLE,
  USER_ROLES,
  isAdminRole,
  isUserRole,
} from "@/lib/auth/roles";

describe("USER_ROLES", () => {
  it("is exactly the vocabulary the users_role_valid CHECK permits", () => {
    // Written twice — here and in the constraint in drizzle/schema.ts — for the
    // same reason as the reporting roles: interpolating one into the other
    // would need sql.raw, banned repo-wide. Two values, so this assertion is
    // the whole of the agreement rather than a parsed diff.
    expect([...USER_ROLES]).toEqual(["admin", "user"]);
  });

  it("defaults new accounts to admin, matching the column default", () => {
    // A lone operator on a single-user install should not have to know roles
    // exist to set their own account up, and every install predating #87 is
    // already admin by virtue of that default.
    expect(DEFAULT_ROLE).toBe("admin");
    expect(ADMIN_ROLE).toBe("admin");
  });
});

describe("isAdminRole", () => {
  it("admits the admin role and nothing else", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("user")).toBe(false);
  });

  it("fails closed on anything unrecognised", () => {
    // A session minted before the CHECK existed, a role deleted in a later
    // release, or a row read back as null must never be an admin.
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole("")).toBe(false);
    expect(isAdminRole("Admin")).toBe(false);
    expect(isAdminRole("superuser")).toBe(false);
  });
});

describe("isUserRole", () => {
  it("accepts each declared role", () => {
    for (const role of USER_ROLES) expect(isUserRole(role)).toBe(true);
  });

  it("rejects unknown values and non-strings", () => {
    // This is what the --role CLI flag validates against, so a typo has to be
    // caught before it reaches the CHECK and surfaces as a constraint error.
    expect(isUserRole("administrator")).toBe(false);
    expect(isUserRole("")).toBe(false);
    expect(isUserRole(null)).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
    expect(isUserRole(1)).toBe(false);
  });
});
