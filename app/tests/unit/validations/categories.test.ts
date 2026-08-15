import { describe, it, expect } from "vitest";
import {
  entityNameSchema,
  accountTypeSchema,
  transactionCategorySchema,
} from "@/lib/validations/categories";
import { REPORTING_ROLE_KEYS } from "@/lib/constants/reporting-roles";

describe("entityNameSchema", () => {
  it("accepts a valid name", () => {
    expect(entityNameSchema.safeParse({ name: "Groceries" }).success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = entityNameSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => String(i.path[0]))).toContain("name");
    }
  });

  it("rejects name over 255 characters", () => {
    expect(
      entityNameSchema.safeParse({ name: "a".repeat(256) }).success
    ).toBe(false);
  });

  it("accepts name at exactly 255 characters", () => {
    expect(
      entityNameSchema.safeParse({ name: "a".repeat(255) }).success
    ).toBe(true);
  });
});

describe("accountTypeSchema", () => {
  it("accepts valid name and categoryId", () => {
    expect(
      accountTypeSchema.safeParse({ name: "Checking", accountTypeCategoryId: "1" }).success
    ).toBe(true);
  });

  it("rejects empty name", () => {
    const result = accountTypeSchema.safeParse({
      name: "",
      accountTypeCategoryId: "1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => String(i.path[0]))).toContain("name");
    }
  });

  it("rejects empty accountTypeCategoryId", () => {
    const result = accountTypeSchema.safeParse({ name: "Checking", accountTypeCategoryId: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => String(i.path[0]))).toContain(
        "accountTypeCategoryId"
      );
    }
  });

  it("rejects non-positive accountTypeCategoryId", () => {
    expect(
      accountTypeSchema.safeParse({ name: "Checking", accountTypeCategoryId: "0" }).success
    ).toBe(false);
    expect(
      accountTypeSchema.safeParse({ name: "Checking", accountTypeCategoryId: "-5" }).success
    ).toBe(false);
  });

  it("rejects non-integer accountTypeCategoryId", () => {
    expect(
      accountTypeSchema.safeParse({ name: "Checking", accountTypeCategoryId: "abc" }).success
    ).toBe(false);
  });
});

describe("transactionCategorySchema", () => {
  const withRole = (reportingRole: unknown) =>
    transactionCategorySchema.safeParse({ name: "Personal Loan Principle", reportingRole });

  it("accepts every role the registry declares", () => {
    for (const key of REPORTING_ROLE_KEYS) {
      const result = withRole(key);
      expect(result.success, key).toBe(true);
      if (result.success) expect(result.data.reportingRole).toBe(key);
    }
  });

  it("normalises an absent field to null", () => {
    // formData.get() yields null when the form does not render the picker —
    // which is every caller that is not the Transaction Categories card.
    const result = withRole(null);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reportingRole).toBeNull();
  });

  it("normalises the picker's None option to null, so a role can be cleared", () => {
    // The picker submits "" for None. Without this a mis-tag would be permanent.
    const result = withRole("");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reportingRole).toBeNull();
  });

  it("rejects a role the registry does not declare", () => {
    // The database would reject it too, via the CHECK — but as a constraint
    // violation, i.e. driver text where docs/input-validation.md requires an
    // authored message.
    expect(withRole("debt_not_a_role").success).toBe(false);
    expect(withRole("DEBT_PRINCIPLE_PAID").success).toBe(false);
  });

  it("still enforces the name rules", () => {
    expect(
      transactionCategorySchema.safeParse({ name: "", reportingRole: null }).success
    ).toBe(false);
    expect(
      transactionCategorySchema.safeParse({ name: "x".repeat(256), reportingRole: null }).success
    ).toBe(false);
  });
});
