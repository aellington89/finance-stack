import { describe, it, expect } from "vitest";

import {
  DEBT_ACCRUAL_ROLES,
  DEBT_PAYMENT_ROLES,
  DEBT_SERVICE_ROLES,
  REPORTING_ROLES,
  REPORTING_ROLE_KEYS,
  isReportingRoleKey,
  reportingRole,
} from "@/lib/constants/reporting-roles";

describe("REPORTING_ROLES", () => {
  it("has a unique key per role", () => {
    expect(new Set(REPORTING_ROLE_KEYS).size).toBe(REPORTING_ROLE_KEYS.length);
  });

  it("namespaces every key by its domain", () => {
    // The generalisation that makes a second domain cheap: an income or
    // investment role arrives as a new key rather than as a collision with, or
    // a rename of, one of these. See the module header.
    for (const role of REPORTING_ROLES) {
      expect(role.key, `${role.key} should start with "${role.domain}_"`).toMatch(
        new RegExp(`^${role.domain}_`)
      );
    }
  });

  it("gives every role a label and a description for the picker", () => {
    for (const role of REPORTING_ROLES) {
      expect(role.label.length, role.key).toBeGreaterThan(0);
      expect(role.description.length, role.key).toBeGreaterThan(0);
    }
  });
});

describe("debt role groups", () => {
  it("does not put a role in both buckets, which would double-count it", () => {
    const payments = new Set<string>(DEBT_PAYMENT_ROLES);
    for (const role of DEBT_ACCRUAL_ROLES) {
      expect(payments.has(role), `${role} is in both buckets`).toBe(false);
    }
  });

  it("covers exactly the debt-domain roles between them", () => {
    // Asserted against the domain rather than against the whole registry, so
    // adding an income role later does not fail this — but forgetting to bucket
    // a new *debt* role still does, and an unbucketed debt role is one no
    // aggregate would read.
    const debtRoles = REPORTING_ROLES.filter((r) => r.domain === "debt").map((r) => r.key);
    expect([...DEBT_SERVICE_ROLES].sort()).toEqual([...debtRoles].sort());
  });

  it("is the concatenation of the two buckets", () => {
    expect([...DEBT_SERVICE_ROLES].sort()).toEqual(
      [...DEBT_PAYMENT_ROLES, ...DEBT_ACCRUAL_ROLES].sort()
    );
  });
});

describe("reportingRole / isReportingRoleKey", () => {
  it("resolves every declared key", () => {
    for (const key of REPORTING_ROLE_KEYS) {
      expect(reportingRole(key)?.key).toBe(key);
      expect(isReportingRoleKey(key)).toBe(true);
    }
  });

  it("treats null, empty and unknown as no role rather than throwing", () => {
    // A category with no role is the common case, and a role written by a newer
    // build than the one reading it is the downgrade case — neither may break a
    // page render.
    expect(reportingRole(null)).toBeNull();
    expect(reportingRole(undefined)).toBeNull();
    expect(reportingRole("")).toBeNull();
    expect(reportingRole("income_interest_earned")).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(isReportingRoleKey(7)).toBe(false);
    expect(isReportingRoleKey(null)).toBe(false);
    expect(isReportingRoleKey(undefined)).toBe(false);
  });
});
