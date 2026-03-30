import { describe, it, expect } from "vitest";
import { transactionFormSchema } from "@/lib/validations/transaction";

const validBase = {
  transactionDescription: "Grocery Store",
  transactionDate: "2024-03-15",
  amount: "82.50",
  accountId: "1",
  transactionTypeId: "2",
  transactionCategoryId: "3",
};

describe("transactionFormSchema", () => {
  it("accepts valid input without relatedAccountId", () => {
    expect(transactionFormSchema.safeParse(validBase).success).toBe(true);
  });

  it("accepts valid input with relatedAccountId", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      relatedAccountId: "4",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty description", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      transactionDescription: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => String(i.path[0]))).toContain(
        "transactionDescription"
      );
    }
  });

  it("rejects description over 500 characters", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      transactionDescription: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      transactionDate: "March 15, 2024",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => String(i.path[0]))).toContain(
        "transactionDate"
      );
    }
  });

  it("rejects invalid amount format", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      amount: "$82.50",
    });
    expect(result.success).toBe(false);
  });

  it("accepts negative amount", () => {
    expect(
      transactionFormSchema.safeParse({ ...validBase, amount: "-82.50" }).success
    ).toBe(true);
  });

  it("rejects invalid accountId", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      accountId: "0",
    });
    expect(result.success).toBe(false);
  });

  it("treats absent relatedAccountId as valid", () => {
    const { accountId, transactionDescription, transactionDate, amount, transactionTypeId, transactionCategoryId } = validBase;
    expect(transactionFormSchema.safeParse({ accountId, transactionDescription, transactionDate, amount, transactionTypeId, transactionCategoryId }).success).toBe(true);
  });

  it("rejects invalid relatedAccountId when provided", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      relatedAccountId: "-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid transactionTypeId", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      transactionTypeId: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid transactionCategoryId", () => {
    const result = transactionFormSchema.safeParse({
      ...validBase,
      transactionCategoryId: "0",
    });
    expect(result.success).toBe(false);
  });
});
