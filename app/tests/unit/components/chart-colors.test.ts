import { describe, it, expect } from "vitest";
import { chartColorVars } from "@/components/ui/chart-colors";

describe("chartColorVars", () => {
  it("emits one --color-* custom property per configured colour", () => {
    expect(
      chartColorVars({
        income: { label: "Income", color: "#2eb88a" },
        spend: { label: "Spend", color: "#e23670" },
      })
    ).toEqual({ "--color-income": "#2eb88a", "--color-spend": "#e23670" });
  });

  it("skips entries that carry no colour", () => {
    expect(chartColorVars({ value: { label: "Change" } })).toEqual({});
  });

  // The security half (#237). expenses-category-chart builds config keys from
  // database category names, so a key is untrusted input. Anything that is not
  // a bare CSS identifier is refused rather than escaped.
  it("refuses a key that could break out of a CSS declaration", () => {
    const vars = chartColorVars({
      "Groceries}html{display:none": { color: "#fff" },
      "Dining ": { color: "#fff" },
      "a;b": { color: "#fff" },
      "Rent & Utilities": { color: "#fff" },
    });
    expect(vars).toEqual({});
  });

  it("accepts the identifier characters a category name may legitimately use", () => {
    expect(
      chartColorVars({
        Groceries: { color: "#111" },
        "long-term_savings2": { color: "#222" },
      })
    ).toEqual({
      "--color-Groceries": "#111",
      "--color-long-term_savings2": "#222",
    });
  });
});
