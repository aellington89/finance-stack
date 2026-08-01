import { describe, it, expect } from "vitest";
import { parseEntityId } from "@/lib/validations/id";

/**
 * The three rejected shapes in the first block are why this module exists
 * (Issue #179). The guard it replaced — `!id || id <= 0` — accepted all of
 * them, and each one reaches Postgres as a bound parameter on an `integer`
 * column and throws there (22P02 / 22003) instead of returning a validation
 * error to the form.
 */
describe("parseEntityId()", () => {
  it("rejects the values the old !id || id <= 0 guard let through", () => {
    expect(parseEntityId("1.5")).toBeNull();
    expect(parseEntityId("Infinity")).toBeNull();
    expect(parseEntityId("1e400")).toBeNull();
  });

  it("rejects an ID past the int4 ceiling", () => {
    // A fine JavaScript integer, and 22003 "out of range" in Postgres.
    expect(parseEntityId("2147483648")).toBeNull();
    expect(parseEntityId("2147483647")).toBe(2147483647);
  });

  it("rejects non-positive IDs", () => {
    expect(parseEntityId("0")).toBeNull();
    expect(parseEntityId("-1")).toBeNull();
  });

  it("rejects non-numeric and absent input", () => {
    expect(parseEntityId("abc")).toBeNull();
    expect(parseEntityId("")).toBeNull();
    // formData.get() returns null for a field the client never sent.
    expect(parseEntityId(null)).toBeNull();
    expect(parseEntityId(undefined)).toBeNull();
  });

  it("rejects a File, which is what a multipart field can arrive as", () => {
    expect(parseEntityId(new File([], "id.txt"))).toBeNull();
  });

  it("accepts a positive integer, trimming surrounding whitespace", () => {
    expect(parseEntityId("1")).toBe(1);
    expect(parseEntityId("42")).toBe(42);
    expect(parseEntityId(" 7 ")).toBe(7);
  });

  it("accepts a number as well as its string form", () => {
    expect(parseEntityId(12)).toBe(12);
  });
});
