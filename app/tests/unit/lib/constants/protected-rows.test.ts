import { describe, it, expect } from "vitest";

import {
  protectionFor,
  protectionRefusal,
  PROTECTION_TOOLTIP,
  type ProtectedTable,
} from "@/lib/constants/protected-rows";
import { SEED_REFERENCES, SHIPPED_ROWS } from "@/lib/constants/reference-ids";

function shippedGroup(table: string) {
  const group = SHIPPED_ROWS.find((g) => g.table === table);
  if (!group) throw new Error(`SHIPPED_ROWS has no group for ${table}`);
  return group;
}

describe("protectionFor — app-owned rows", () => {
  it("protects every row shared-lookups.sql ships", () => {
    for (const group of SHIPPED_ROWS) {
      for (const { id, name } of group.expected) {
        const protection = protectionFor(group.table as ProtectedTable, id);
        expect(protection, `${group.table} id=${id}`).not.toBeNull();
        expect(protection?.reason).toBe("app-owned");
        expect(protection?.canonicalName).toBe(name);
      }
    }
  });

  it("protects a shipped row that code never names", () => {
    // transaction_types id 3 'Refund' is in no SEED_REFERENCES group and no
    // query pins it — it is protected because it ships, which is the whole
    // difference between SHIPPED_ROWS and SEED_REFERENCES.
    const named = new Set(
      SEED_REFERENCES.flatMap((g) =>
        g.table === "transaction_types" ? g.expected.map((r) => r.id) : []
      )
    );
    expect(named.has(3)).toBe(false);

    const protection = protectionFor("transaction_types", 3);
    expect(protection?.reason).toBe("app-owned");
  });

  it("stays protected under a drifted name, and reports the canonical one", () => {
    // An install that renamed id 6 before Issue #109 landed keeps its name. The
    // row must still be protected, and must still know what it should be called
    // — that is what makes the rename-back repair possible.
    const protection = protectionFor("transaction_categories", 6);
    expect(protection?.reason).toBe("app-owned");
    expect(protection?.canonicalName).toBe("Other");
  });

  it("does not leak ids across tables", () => {
    // account_type_categories ships ids 1-6; transaction_categories ships only
    // id 6. Asking the wrong table must not find a row.
    expect(protectionFor("transaction_categories", 1)).toBeNull();
    expect(protectionFor("transaction_categories", 5)).toBeNull();
  });

  it("leaves ids past the shipped range alone", () => {
    const maxTypeId = Math.max(...shippedGroup("transaction_types").expected.map((r) => r.id));
    expect(protectionFor("transaction_types", maxTypeId + 1)).toBeNull();
    expect(protectionFor("account_type_categories", 999)).toBeNull();
  });
});

// Issue #111 removed the second protection rule. The Liabilities aggregates
// used to name fifteen transaction_categories rows by id, so those rows were
// locked against rename and delete even though they are the user's and ship
// nowhere. The meaning now lives in transaction_categories.reporting_role, so
// renaming one drops it out of nothing and there is no reason left to lock it.
//
// These assert the un-protection, because it is the user-visible half of #111:
// rows that could not be edited before this landed can be edited now.
describe("protectionFor — the former liability pins are ordinary user rows", () => {
  // The ids the deleted DEBT_PAYMENT_CATEGORIES / DEBT_INTEREST_CATEGORIES
  // lists held, spelled out rather than imported — the constants are gone, and
  // the point of the test is that nothing in the codebase knows these numbers
  // any more.
  const FORMER_PINS = [
    { id: 7, name: "HELOC Principle" },
    { id: 8, name: "HELOC Interest" },
    { id: 9, name: "Accrued HELOC Interest" },
    { id: 12, name: "Mortgage Principle" },
    { id: 13, name: "Mortgage Interest" },
    { id: 14, name: "Accrued Mortgage Interest" },
    { id: 29, name: "Applied Credit" },
    { id: 57, name: "Epic Loan Interest" },
    { id: 68, name: "Auto Loan Interest" },
    { id: 69, name: "Accrued Auto Loan Interest" },
    { id: 70, name: "Auto Loan Principle" },
    { id: 74, name: "Accrued Student Loan Interest" },
    { id: 75, name: "Student Loan Principle" },
    { id: 76, name: "Student Loan Interest" },
    { id: 80, name: "Credit Card Interest" },
  ];

  it("leaves every former pin editable", () => {
    const shippedCategoryIds = new Set(
      shippedGroup("transaction_categories").expected.map((r) => r.id)
    );

    for (const { id } of FORMER_PINS) {
      // None of them is also a shipped row, so a null here can only mean the
      // pin rule is gone rather than that some other rule is covering for it.
      expect(shippedCategoryIds.has(id), `id=${id} should not be shipped`).toBe(false);
      expect(protectionFor("transaction_categories", id), `former pin id=${id}`).toBeNull();
    }
  });

  it("still protects the one category that does ship", () => {
    // The counterweight: #111 unlocked the pins, not the app-owned rule.
    expect(protectionFor("transaction_categories", 6)?.reason).toBe("app-owned");
  });
});

describe("SEED_REFERENCES ⊆ SHIPPED_ROWS", () => {
  it("declares every referenced row as shipped, with the same name", () => {
    for (const group of SEED_REFERENCES) {
      const shipped = shippedGroup(group.table);
      for (const { id, name } of group.expected) {
        const match = shipped.expected.find((r) => r.id === id);
        expect(match, `${group.table} id=${id} is referenced but not shipped`).toBeDefined();
        expect(match?.name).toBe(name);
      }
    }
  });
});

describe("protectionRefusal", () => {
  const appOwned = { reason: "app-owned" as const, canonicalName: "Other" };

  it("refuses a delete without offering a way through", () => {
    expect(protectionRefusal(appOwned, "delete", "category")).toBe(
      "Cannot delete: this category is protected — it ships with the app."
    );
  });

  it("names the canonical name on a rename, so a drifted row has a repair", () => {
    const message = protectionRefusal(appOwned, "rename", "category");
    expect(message).toContain("Other");
    expect(message).toMatch(/renamed back/i);
  });

  it("uses the caller's entity label", () => {
    expect(protectionRefusal(appOwned, "delete", "type")).toContain("this type");
  });

  it("has tooltip copy for every reason", () => {
    expect(PROTECTION_TOOLTIP["app-owned"]).toBeTruthy();
  });
});
