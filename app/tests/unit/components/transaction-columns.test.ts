import { describe, it, expect } from "vitest";
import {
  ALL_COLUMN_KEYS,
  parseVisibleColumnsCookie,
} from "@/components/transactions/transaction-columns";

describe("parseVisibleColumnsCookie", () => {
  it("falls back to every column when the cookie is absent", () => {
    expect(parseVisibleColumnsCookie(undefined)).toEqual(ALL_COLUMN_KEYS);
  });

  it("falls back to every column when the cookie is empty", () => {
    expect(parseVisibleColumnsCookie("")).toEqual(ALL_COLUMN_KEYS);
  });

  it("returns a copy rather than the shared constant", () => {
    const parsed = parseVisibleColumnsCookie(undefined);
    parsed.pop();
    expect(ALL_COLUMN_KEYS).toHaveLength(7);
  });

  it("round-trips a URI-encoded subset", () => {
    const value = encodeURIComponent(JSON.stringify(["date", "amount"]));
    expect(parseVisibleColumnsCookie(value)).toEqual(["date", "amount"]);
  });

  it("drops keys that are not real columns", () => {
    const value = encodeURIComponent(JSON.stringify(["date", "nonsense"]));
    expect(parseVisibleColumnsCookie(value)).toEqual(["date"]);
  });

  it("falls back when filtering leaves nothing — an all-bogus cookie must not hide every column", () => {
    const value = encodeURIComponent(JSON.stringify(["nonsense"]));
    expect(parseVisibleColumnsCookie(value)).toEqual(ALL_COLUMN_KEYS);
  });

  it("falls back when the payload is valid JSON but not an array", () => {
    const value = encodeURIComponent(JSON.stringify({ date: true }));
    expect(parseVisibleColumnsCookie(value)).toEqual(ALL_COLUMN_KEYS);
  });

  it("falls back when the cookie is not JSON at all", () => {
    expect(parseVisibleColumnsCookie("%7Bnot-json")).toEqual(ALL_COLUMN_KEYS);
  });
});
