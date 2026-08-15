import { describe, it, expect } from "vitest";

import {
  protectionFor,
  protectionRefusal,
  PROTECTION_TOOLTIP,
  type ProtectedTable,
} from "@/lib/constants/protected-rows";
import { SEED_REFERENCES, SHIPPED_ROWS } from "@/lib/constants/reference-ids";
import {
  DEBT_INTEREST_CATEGORIES,
  DEBT_PAYMENT_CATEGORIES,
} from "@/lib/queries/liability-categories";

const PINS = [...DEBT_PAYMENT_CATEGORIES, ...DEBT_INTEREST_CATEGORIES];

function shippedGroup(table: string) {
  const group = SHIPPED_ROWS.find((g) => g.table === table);
  if (!group) throw new Error(`SHIPPED_ROWS has no group for ${table}`);
  return group;
}

describe("protectionFor — app-owned rows", () => {
  it("protects every row shared-lookups.sql ships", () => {
    for (const group of SHIPPED_ROWS) {
      for (const { id, name } of group.expected) {
        const protection = protectionFor(group.table as ProtectedTable, id, name);
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

    const protection = protectionFor("transaction_types", 3, "Refund");
    expect(protection?.reason).toBe("app-owned");
  });

  it("stays protected under a drifted name, and reports the canonical one", () => {
    // An install that renamed id 6 before Issue #109 landed keeps its name. The
    // row must still be protected, and must still know what it should be called
    // — that is what makes the rename-back repair possible.
    const protection = protectionFor("transaction_categories", 6, "Miscellaneous");
    expect(protection?.reason).toBe("app-owned");
    expect(protection?.canonicalName).toBe("Other");
  });

  it("does not leak ids across tables", () => {
    // account_type_categories ships ids 1-6; transaction_categories ships only
    // id 6. Asking the wrong table must not find a row.
    expect(protectionFor("transaction_categories", 1, "Current Asset")).toBeNull();
    expect(protectionFor("transaction_categories", 5, "Current Liability")).toBeNull();
  });

  it("leaves ids past the shipped range alone", () => {
    const maxTypeId = Math.max(...shippedGroup("transaction_types").expected.map((r) => r.id));
    expect(protectionFor("transaction_types", maxTypeId + 1, "My Own Type")).toBeNull();
    expect(protectionFor("account_type_categories", 999, "Intangible Asset")).toBeNull();
  });
});

describe("protectionFor — liability pins", () => {
  it("protects each pin under its canonical name", () => {
    for (const { id, name } of PINS) {
      const protection = protectionFor("transaction_categories", id, name);
      expect(protection, `pin id=${id}`).not.toBeNull();
      expect(protection?.canonicalName).toBe(name);
    }
  });

  it("does not protect a pinned id carrying a different name", () => {
    // The rule that keeps protection correct on somebody else's database: id 7
    // is "HELOC Principle" here and could be anything there.
    for (const { id } of PINS) {
      expect(protectionFor("transaction_categories", id, "Coffee"), `pin id=${id}`).toBeNull();
    }
  });

  it("applies only to transaction_categories", () => {
    // Past the shipped id ranges of the other two tables, so an app-owned hit
    // cannot mask the thing being asserted. (Low pin ids like 7 DO come back
    // protected for transaction_types — id 7 there is the shipped 'Other' —
    // which is the app-owned rule working, not the pin rule leaking.)
    const highestShipped = Math.max(
      ...SHIPPED_ROWS.flatMap((g) => g.expected.map((r) => r.id))
    );
    const pin = PINS.find((p) => p.id > highestShipped);
    expect(pin, "expected at least one pin past the shipped id range").toBeDefined();

    expect(protectionFor("transaction_types", pin!.id, pin!.name)).toBeNull();
    expect(protectionFor("account_type_categories", pin!.id, pin!.name)).toBeNull();
  });

  it("reports app-owned rather than liability-pin where the two could overlap", () => {
    const shippedCategoryIds = new Set(
      shippedGroup("transaction_categories").expected.map((r) => r.id)
    );
    const overlapping = PINS.filter((p) => shippedCategoryIds.has(p.id));
    // There is no overlap today; if a pin is ever also shipped, app-owned is
    // the stronger rule and must win.
    expect(overlapping).toEqual([]);
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
  const pin = { reason: "liability-pin" as const, canonicalName: "Mortgage Interest" };

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

  it("gives the liability reason for a pinned row", () => {
    expect(protectionRefusal(pin, "delete", "category")).toContain("Liabilities drilldown");
  });

  it("uses the caller's entity label", () => {
    expect(protectionRefusal(appOwned, "delete", "type")).toContain("this type");
  });

  it("has tooltip copy for every reason", () => {
    expect(PROTECTION_TOOLTIP["app-owned"]).toBeTruthy();
    expect(PROTECTION_TOOLTIP["liability-pin"]).toBeTruthy();
  });
});
