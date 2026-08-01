import { describe, it, expect } from "vitest";
import {
  getParam,
  validateFilterParams,
} from "@/lib/validations/search-params";

describe("getParam()", () => {
  it("returns the first value of a repeated param", () => {
    expect(getParam({ sortBy: ["amount", "accountName"] }, "sortBy")).toBe("amount");
  });

  it("treats absent and empty as undefined", () => {
    expect(getParam({}, "sortBy")).toBeUndefined();
    expect(getParam({ sortBy: "" }, "sortBy")).toBeUndefined();
    expect(getParam({ sortBy: [] }, "sortBy")).toBeUndefined();
  });
});

describe("validateFilterParams()", () => {
  it("parses a well-formed ID list", () => {
    const result = validateFilterParams({ accountIds: "1,2,3" });
    expect(result).toMatchObject({ ok: true, accountIds: [1, 2, 3] });
  });

  it("rejects a list containing a non-integer ID", () => {
    // The reason for the change: Number("1.5") is not NaN, so the previous
    // `.filter((n) => !isNaN(n))` kept it and bound it into an IN (…) on an
    // integer column, throwing 22P02 during render.
    const result = validateFilterParams({ accountIds: "1,1.5" });
    expect(result.ok).toBe(false);
  });

  it("rejects rather than silently dropping the bad entry", () => {
    // Explicitly not `{ ok: true, accountIds: [1] }` — querying the remainder
    // answers a question the user did not ask.
    const result = validateFilterParams({ accountIds: "1,abc" });
    expect(result).not.toMatchObject({ ok: true });
  });

  it("names the offending filter in the message", () => {
    const account = validateFilterParams({ accountIds: "1.5" });
    const type = validateFilterParams({ typeIds: "1.5" });
    const category = validateFilterParams({ categoryIds: "1.5" });

    expect(account.ok).toBe(false);
    expect(type.ok).toBe(false);
    expect(category.ok).toBe(false);
    if (account.ok || type.ok || category.ok) return;

    expect(account.error).toMatch(/account/i);
    expect(type.error).toMatch(/transaction type/i);
    expect(category.error).toMatch(/category/i);
  });

  it("rejects an out-of-range ID", () => {
    expect(validateFilterParams({ categoryIds: "2147483648" }).ok).toBe(false);
  });

  it("accepts a well-formed amount and rejects a malformed one", () => {
    expect(validateFilterParams({ amount: "123.45" })).toMatchObject({
      ok: true,
      amount: "123.45",
    });
    expect(validateFilterParams({ amount: "-50.00" }).ok).toBe(true);
    expect(validateFilterParams({ amount: "abc" }).ok).toBe(false);
    expect(validateFilterParams({ amount: "1.234" }).ok).toBe(false);
  });

  it("passes descriptions through as free text", () => {
    // A text column, bound as a parameter — no format to enforce.
    expect(
      validateFilterParams({ descriptions: "Groceries,Rent & Utilities" })
    ).toMatchObject({ ok: true, descriptions: ["Groceries", "Rent & Utilities"] });
  });

  it("returns ok with everything undefined when no filters are present", () => {
    expect(validateFilterParams({})).toEqual({
      ok: true,
      descriptions: undefined,
      accountIds: undefined,
      typeIds: undefined,
      categoryIds: undefined,
      amount: undefined,
    });
  });

  it("ignores empty entries in a list", () => {
    expect(validateFilterParams({ accountIds: "1,,2" })).toMatchObject({
      ok: true,
      accountIds: [1, 2],
    });
  });
});
