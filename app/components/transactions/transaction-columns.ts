export type ColumnKey =
  | "date"
  | "description"
  | "amount"
  | "account"
  | "relatedAccount"
  | "type"
  | "category";

export const ALL_COLUMN_KEYS: ColumnKey[] = [
  "date",
  "description",
  "amount",
  "account",
  "relatedAccount",
  "type",
  "category",
];

export const VISIBLE_COLUMNS_COOKIE = "txn-visible-columns";
export const VISIBLE_COLUMNS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseVisibleColumnsCookie(
  value: string | undefined
): ColumnKey[] {
  if (!value) return [...ALL_COLUMN_KEYS];
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (!Array.isArray(parsed)) return [...ALL_COLUMN_KEYS];
    const valid = parsed.filter((k): k is ColumnKey =>
      ALL_COLUMN_KEYS.includes(k as ColumnKey)
    );
    return valid.length > 0 ? valid : [...ALL_COLUMN_KEYS];
  } catch {
    return [...ALL_COLUMN_KEYS];
  }
}
