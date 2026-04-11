import { describe, it, expect } from "vitest";
import { getPostSubmitState } from "@/lib/forms/transaction";

describe("getPostSubmitState()", () => {
  const filled = {
    transactionDate: "2026-04-10",
    amount: "42.50",
    accountId: "3",
    relatedAccountId: "7",
    transactionTypeId: "2",
    transactionCategoryId: "11",
  };

  it("persists Date across a successful submit", () => {
    expect(getPostSubmitState(filled).transactionDate).toBe("2026-04-10");
  });

  it("persists Account across a successful submit", () => {
    expect(getPostSubmitState(filled).accountId).toBe("3");
  });

  it("persists Transaction Type across a successful submit", () => {
    expect(getPostSubmitState(filled).transactionTypeId).toBe("2");
  });

  it("clears Amount", () => {
    expect(getPostSubmitState(filled).amount).toBe("");
  });

  it("clears Related Account", () => {
    expect(getPostSubmitState(filled).relatedAccountId).toBe("");
  });

  it("clears Category", () => {
    expect(getPostSubmitState(filled).transactionCategoryId).toBe("");
  });

  it("does not mutate its input", () => {
    const snapshot = { ...filled };
    getPostSubmitState(filled);
    expect(filled).toEqual(snapshot);
  });
});
