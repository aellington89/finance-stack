import { describe, it, expect } from "vitest";
import {
  DEBT_INTEREST_CATEGORY_IDS,
  DEBT_PAYMENT_CATEGORY_IDS,
  LIABILITY_CATEGORY_IDS,
  LIABILITY_CURRENT_CATEGORY_ID,
  LIABILITY_NON_CURRENT_CATEGORY_ID,
} from "@/lib/queries/liability-categories";

describe("LIABILITY_CATEGORY_IDS", () => {
  it("contains exactly the two liability category IDs from shared-lookups", () => {
    expect(LIABILITY_CURRENT_CATEGORY_ID).toBe(5);
    expect(LIABILITY_NON_CURRENT_CATEGORY_ID).toBe(6);
    expect([...LIABILITY_CATEGORY_IDS].sort()).toEqual([5, 6]);
  });
});

describe("DEBT_PAYMENT_CATEGORY_IDS", () => {
  it("is non-empty and contains only positive integers", () => {
    expect(DEBT_PAYMENT_CATEGORY_IDS.length).toBeGreaterThan(0);
    for (const id of DEBT_PAYMENT_CATEGORY_IDS) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
    }
  });

  it("has no duplicates", () => {
    const set = new Set(DEBT_PAYMENT_CATEGORY_IDS);
    expect(set.size).toBe(DEBT_PAYMENT_CATEGORY_IDS.length);
  });
});

describe("DEBT_INTEREST_CATEGORY_IDS", () => {
  it("is non-empty and contains only positive integers", () => {
    expect(DEBT_INTEREST_CATEGORY_IDS.length).toBeGreaterThan(0);
    for (const id of DEBT_INTEREST_CATEGORY_IDS) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
    }
  });

  it("has no duplicates", () => {
    const set = new Set(DEBT_INTEREST_CATEGORY_IDS);
    expect(set.size).toBe(DEBT_INTEREST_CATEGORY_IDS.length);
  });

  it("does not overlap with payment IDs (would double-count)", () => {
    const paymentSet = new Set<number>(DEBT_PAYMENT_CATEGORY_IDS);
    for (const id of DEBT_INTEREST_CATEGORY_IDS) {
      expect(paymentSet.has(id)).toBe(false);
    }
  });
});
