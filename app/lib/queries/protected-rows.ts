// Reads backing the protection guards in lib/actions/categories.ts (issue #109).
//
// The liability-pin rule matches on the row's current name, so the guard needs
// the database's copy of it — the name in the submitted form is what the user
// wants it to become, not what it is.
//
// Three concrete functions rather than one that takes a table name: dispatching
// on a string would mean interpolating an identifier into the query, and
// sql.raw is banned repo-wide by eslint.config.mjs (docs/input-validation.md).
// The query builder binds each table statically instead.

import { db } from "@/lib/db";
import {
  accountTypeCategories,
  transactionCategories,
  transactionTypes,
} from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { protectionFor, type Protection } from "@/lib/constants/protected-rows";

export async function transactionCategoryProtection(id: number): Promise<Protection | null> {
  const rows = await db
    .select({ name: transactionCategories.transactionCategory })
    .from(transactionCategories)
    .where(eq(transactionCategories.transactionCategoryId, id))
    .limit(1);

  if (rows.length === 0) return null;
  return protectionFor("transaction_categories", id, rows[0].name);
}

export async function transactionTypeProtection(id: number): Promise<Protection | null> {
  const rows = await db
    .select({ name: transactionTypes.transactionType })
    .from(transactionTypes)
    .where(eq(transactionTypes.transactionTypeId, id))
    .limit(1);

  if (rows.length === 0) return null;
  return protectionFor("transaction_types", id, rows[0].name);
}

export async function accountTypeCategoryProtection(id: number): Promise<Protection | null> {
  const rows = await db
    .select({ name: accountTypeCategories.accountTypeCategory })
    .from(accountTypeCategories)
    .where(eq(accountTypeCategories.accountTypeCategoryId, id))
    .limit(1);

  if (rows.length === 0) return null;
  return protectionFor("account_type_categories", id, rows[0].name);
}
