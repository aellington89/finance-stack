import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn()", () => {
  it("merges multiple class strings", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("resolves conflicting Tailwind classes (last wins)", () => {
    // tailwind-merge keeps the last value for conflicting utilities
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("drops falsy values", () => {
    expect(cn("base", false && "ignored", undefined, null, "kept")).toBe(
      "base kept"
    );
  });

  it("handles conditional objects (clsx style)", () => {
    expect(cn({ active: true, disabled: false })).toBe("active");
  });

  it("returns empty string when no valid classes provided", () => {
    expect(cn(false, undefined, null)).toBe("");
  });
});
