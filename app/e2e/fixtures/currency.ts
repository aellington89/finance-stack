import { expect } from "@playwright/test";

/**
 * "$1,234.56" / "-$321.45" → a number. Never string-compare these: the page
 * renders Intl.NumberFormat output, so a grouping separator or a locale
 * difference would fail an assertion that money arithmetic passed.
 */
export function parseCurrency(text: string): number {
  const cleaned = text.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  expect(cleaned, `could not parse a currency value from "${text}"`).not.toBe("");
  expect(Number.isNaN(value), `could not parse a currency value from "${text}"`).toBe(false);
  return value;
}
