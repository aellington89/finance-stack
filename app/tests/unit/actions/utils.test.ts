import { describe, it, expect } from "vitest";
import { buildFieldErrors } from "@/lib/actions/utils";

describe("buildFieldErrors()", () => {
  it("maps a single issue to its field", () => {
    const result = buildFieldErrors([
      { path: ["accountName"], message: "Required" },
    ]);
    expect(result).toEqual({ accountName: ["Required"] });
  });

  it("accumulates multiple messages for the same field", () => {
    const result = buildFieldErrors([
      { path: ["accountName"], message: "Required" },
      { path: ["accountName"], message: "Too short" },
    ]);
    expect(result).toEqual({ accountName: ["Required", "Too short"] });
  });

  it("handles multiple distinct fields", () => {
    const result = buildFieldErrors([
      { path: ["accountName"], message: "Required" },
      { path: ["accountTypeId"], message: "Invalid" },
    ]);
    expect(result).toEqual({
      accountName: ["Required"],
      accountTypeId: ["Invalid"],
    });
  });

  it("returns empty object for empty issues array", () => {
    expect(buildFieldErrors([])).toEqual({});
  });
});
