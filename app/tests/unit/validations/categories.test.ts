import { describe, it, expect } from "vitest";
import { entityNameSchema, accountTypeSchema } from "@/lib/validations/categories";

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
