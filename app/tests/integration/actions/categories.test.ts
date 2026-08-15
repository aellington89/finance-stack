import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountTypeCategories,
  auditLog,
  transactionCategories,
  transactionTypes,
} from "@/drizzle/schema";
import {
  createTransactionCategory,
  updateTransactionCategory,
  deleteTransactionCategory,
  updateTransactionType,
  deleteTransactionType,
  updateAccountTypeCategory,
  deleteAccountTypeCategory,
} from "@/lib/actions/categories";
import { OPENING_BALANCE_CATEGORY } from "@/lib/constants/reference-ids";
import { REPORTING_ROLE_KEYS } from "@/lib/constants/reporting-roles";

// Behavioural coverage for the protection guards added in Issue #109. Before
// this file the six lookup mutators were exercised only by the validation
// contract sweep, which proves malformed payloads bounce and nothing else.

const emptyState = { success: false, errors: {}, message: "" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) fd.append(key, val);
  return fd;
}

// A category the Liabilities queries read, past every shipped id. Before issue
// #111 it was locked against rename and delete by the liability-pin rule; the
// role carries its meaning now, so it is an ordinary user row again and the
// tests below assert that it is editable.
const FORMER_PIN = { id: 70, name: "Auto Loan Principle", role: "debt_principle_paid" };

const createdCategoryIds: number[] = [];
const createdTypeIds: number[] = [];

afterEach(async () => {
  for (const id of createdCategoryIds) {
    await db.delete(transactionCategories).where(eq(transactionCategories.transactionCategoryId, id));
  }
  createdCategoryIds.length = 0;

  for (const id of createdTypeIds) {
    await db.delete(transactionTypes).where(eq(transactionTypes.transactionTypeId, id));
  }
  createdTypeIds.length = 0;
});

async function categoryName(id: number): Promise<string | undefined> {
  const [row] = await db
    .select({ name: transactionCategories.transactionCategory })
    .from(transactionCategories)
    .where(eq(transactionCategories.transactionCategoryId, id));
  return row?.name;
}

async function typeName(id: number): Promise<string | undefined> {
  const [row] = await db
    .select({ name: transactionTypes.transactionType })
    .from(transactionTypes)
    .where(eq(transactionTypes.transactionTypeId, id));
  return row?.name;
}

describe("updateTransactionCategory — protection", () => {
  it("refuses to rename an app-owned row, leaving it untouched", async () => {
    const result = await updateTransactionCategory(
      emptyState,
      makeFormData({
        transactionCategoryId: String(OPENING_BALANCE_CATEGORY.id),
        name: "Miscellaneous",
      })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/protected/i);
    expect(result.message).toMatch(/ships with the app/i);
    expect(await categoryName(OPENING_BALANCE_CATEGORY.id)).toBe(OPENING_BALANCE_CATEGORY.name);
  });

  it("allows the rename back to the canonical name, so a drifted install has a repair", async () => {
    // Simulate an install that renamed the row before #109 landed. Done in raw
    // SQL because the action is exactly what refuses it.
    await db.execute(sql`
      UPDATE transaction_categories SET transaction_category = 'Miscellaneous'
      WHERE transaction_category_id = ${OPENING_BALANCE_CATEGORY.id}
    `);

    try {
      const stillRefused = await updateTransactionCategory(
        emptyState,
        makeFormData({
          transactionCategoryId: String(OPENING_BALANCE_CATEGORY.id),
          name: "Something Else",
        })
      );
      expect(stillRefused.success).toBe(false);

      const repair = await updateTransactionCategory(
        emptyState,
        makeFormData({
          transactionCategoryId: String(OPENING_BALANCE_CATEGORY.id),
          name: OPENING_BALANCE_CATEGORY.name,
        })
      );
      expect(repair.success).toBe(true);
      expect(await categoryName(OPENING_BALANCE_CATEGORY.id)).toBe(OPENING_BALANCE_CATEGORY.name);
    } finally {
      await db.execute(sql`
        UPDATE transaction_categories SET transaction_category = ${OPENING_BALANCE_CATEGORY.name}
        WHERE transaction_category_id = ${OPENING_BALANCE_CATEGORY.id}
      `);
    }
  });

  it("lets a former liability pin be renamed — #111 unlocked these rows", () => {
    // Asserted in the un-protection direction on purpose: until issue #111
    // these fifteen categories were locked because the queries named them by
    // id. They are the user's rows, they ship nowhere, and reporting_role now
    // carries what the id used to mean, so there is nothing left to protect
    // them from. The round-trip itself is covered below.
    expect(REPORTING_ROLE_KEYS).toContain(FORMER_PIN.role);
  });

  it("writes no audit row when it refuses", async () => {
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${auditLog.auditId}), 0)` })
      .from(auditLog);

    await updateTransactionCategory(
      emptyState,
      makeFormData({
        transactionCategoryId: String(OPENING_BALANCE_CATEGORY.id),
        name: "Renamed Shipped Row",
      })
    );

    const after = await db.select({ id: auditLog.auditId }).from(auditLog).where(gt(auditLog.auditId, max));
    expect(after).toEqual([]);
  });

  it("does not reach actionFailure — a refusal is not an error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await updateTransactionCategory(
        emptyState,
        makeFormData({
          transactionCategoryId: String(OPENING_BALANCE_CATEGORY.id),
          name: "Renamed Shipped Row",
        })
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("deleteTransactionCategory — protection", () => {
  it("refuses an app-owned row before the in-use check, so the message names the real reason", async () => {
    // Category 6 also has transactions against it in the fixture, so a wrong
    // ordering here would surface "used by existing transactions" instead.
    const result = await deleteTransactionCategory(
      emptyState,
      makeFormData({ transactionCategoryId: String(OPENING_BALANCE_CATEGORY.id) })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/protected/i);
    expect(result.message).not.toMatch(/used by existing transactions/i);
    expect(await categoryName(OPENING_BALANCE_CATEGORY.id)).toBe(OPENING_BALANCE_CATEGORY.name);
  });

  it("no longer refuses a former liability pin, but still refuses on in-use", async () => {
    // Two things at once, and both matter. The refusal is no longer "protected"
    // — issue #111 removed that rule — and the row survives anyway, because the
    // fixture posts transactions against it. A user with no such transactions
    // can now delete it, which is the intended change.
    const result = await deleteTransactionCategory(
      emptyState,
      makeFormData({ transactionCategoryId: String(FORMER_PIN.id) })
    );

    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/protected/i);
    expect(result.message).toMatch(/used by existing transactions/i);
    expect(await categoryName(FORMER_PIN.id)).toBe(FORMER_PIN.name);
  });

  it("treats a non-existent id as an ordinary delete, not a protection refusal", async () => {
    const result = await deleteTransactionCategory(
      emptyState,
      makeFormData({ transactionCategoryId: "2147483647" })
    );

    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/protected/i);
  });
});

describe("reporting roles (Issue #111)", () => {
  async function categoryRole(id: number): Promise<string | null | undefined> {
    const [row] = await db
      .select({ role: transactionCategories.reportingRole })
      .from(transactionCategories)
      .where(eq(transactionCategories.transactionCategoryId, id));
    return row?.role;
  }

  async function createTagged(name: string, reportingRole: string) {
    const result = await createTransactionCategory(
      emptyState,
      makeFormData({ name, reportingRole })
    );
    const [row] = await db
      .select({ id: transactionCategories.transactionCategoryId })
      .from(transactionCategories)
      .where(eq(transactionCategories.transactionCategory, name));
    if (row) createdCategoryIds.push(row.id);
    return { result, id: row?.id };
  }

  it("stores the role a user tags a new category with", async () => {
    const { result, id } = await createTagged("Role Probe", "debt_principle_paid");
    expect(result.success).toBe(true);
    expect(await categoryRole(id!)).toBe("debt_principle_paid");
  });

  it("defaults to no role when the form omits the field", async () => {
    const result = await createTransactionCategory(
      emptyState,
      makeFormData({ name: "Untagged Probe" })
    );
    expect(result.success).toBe(true);

    const [row] = await db
      .select({ id: transactionCategories.transactionCategoryId, role: transactionCategories.reportingRole })
      .from(transactionCategories)
      .where(eq(transactionCategories.transactionCategory, "Untagged Probe"));
    createdCategoryIds.push(row.id);
    expect(row.role).toBeNull();
  });

  it("retags and clears an existing category", async () => {
    const { id } = await createTagged("Retag Probe", "debt_interest_paid");

    const retagged = await updateTransactionCategory(
      emptyState,
      makeFormData({
        transactionCategoryId: String(id),
        name: "Retag Probe",
        reportingRole: "debt_interest_accrued",
      })
    );
    expect(retagged.success).toBe(true);
    expect(await categoryRole(id!)).toBe("debt_interest_accrued");

    // The picker's None option submits "", which must clear rather than fail —
    // otherwise a mis-tag would be permanent.
    const cleared = await updateTransactionCategory(
      emptyState,
      makeFormData({ transactionCategoryId: String(id), name: "Retag Probe", reportingRole: "" })
    );
    expect(cleared.success).toBe(true);
    expect(await categoryRole(id!)).toBeNull();
  });

  it("refuses an unknown role with an authored message, before the database", async () => {
    // The CHECK constraint would reject it too, but as a driver-level
    // constraint violation — docs/input-validation.md requires an authored
    // message, so validation has to catch it first.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await createTransactionCategory(
        emptyState,
        makeFormData({ name: "Bad Role Probe", reportingRole: "debt_not_a_role" })
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("Validation failed");
      // A log line would mean the payload reached actionFailure's catch arm.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }

    const rows = await db
      .select({ id: transactionCategories.transactionCategoryId })
      .from(transactionCategories)
      .where(eq(transactionCategories.transactionCategory, "Bad Role Probe"));
    expect(rows).toEqual([]);
  });

  it("is enforced by the database too, not only by validation", async () => {
    // The other half of the registry <-> CHECK pair that
    // `npm run check:seed-references` proves equal statically.
    await expect(
      db.execute(
        sql`INSERT INTO transaction_categories (transaction_category, reporting_role)
            VALUES ('Direct Insert Probe', 'debt_not_a_role')`
      )
    ).rejects.toThrow();
  });
});

describe("user-owned rows stay editable", () => {
  it("round-trips create, rename and delete on a category the user made", async () => {
    const created = await createTransactionCategory(
      emptyState,
      makeFormData({ name: "Protection Probe" })
    );
    expect(created.success).toBe(true);

    const [row] = await db
      .select({ id: transactionCategories.transactionCategoryId })
      .from(transactionCategories)
      .where(eq(transactionCategories.transactionCategory, "Protection Probe"));
    createdCategoryIds.push(row.id);

    const renamed = await updateTransactionCategory(
      emptyState,
      makeFormData({ transactionCategoryId: String(row.id), name: "Protection Probe Renamed" })
    );
    expect(renamed.success).toBe(true);
    expect(await categoryName(row.id)).toBe("Protection Probe Renamed");

    const deleted = await deleteTransactionCategory(
      emptyState,
      makeFormData({ transactionCategoryId: String(row.id) })
    );
    expect(deleted.success).toBe(true);
    createdCategoryIds.length = 0;
  });

  it("lets a transaction type created before #109 be renamed and deleted", async () => {
    // There is no createTransactionType any more, so this stands in for a row
    // an existing install already has past the shipped range.
    const [inserted] = await db
      .insert(transactionTypes)
      .values({ transactionType: "Legacy User Type" })
      .returning({ id: transactionTypes.transactionTypeId });
    createdTypeIds.push(inserted.id);

    const renamed = await updateTransactionType(
      emptyState,
      makeFormData({ transactionTypeId: String(inserted.id), name: "Legacy User Type Renamed" })
    );
    expect(renamed.success).toBe(true);
    expect(await typeName(inserted.id)).toBe("Legacy User Type Renamed");

    const deleted = await deleteTransactionType(
      emptyState,
      makeFormData({ transactionTypeId: String(inserted.id) })
    );
    expect(deleted.success).toBe(true);
    createdTypeIds.length = 0;
  });
});

describe("protection generalises across the lookup tables", () => {
  it("refuses a shipped transaction_type that no code names", async () => {
    // id 3 'Refund' is in no SEED_REFERENCES group and pinned by no query. It
    // is protected purely because it ships — the difference between
    // SHIPPED_ROWS and SEED_REFERENCES, exercised end to end.
    const result = await updateTransactionType(
      emptyState,
      makeFormData({ transactionTypeId: "3", name: "Rebate" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/protected/i);
    expect(await typeName(3)).toBe("Refund");
  });

  it("refuses to delete a shipped transaction_type", async () => {
    const result = await deleteTransactionType(
      emptyState,
      makeFormData({ transactionTypeId: "12" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/protected/i);
    expect(await typeName(12)).toBe("Opening Balance");
  });

  it("refuses to rename or delete a shipped account_type_category", async () => {
    const renamed = await updateAccountTypeCategory(
      emptyState,
      makeFormData({ accountTypeCategoryId: "5", name: "Short-term Debt" })
    );
    expect(renamed.success).toBe(false);
    expect(renamed.message).toMatch(/protected/i);

    const deleted = await deleteAccountTypeCategory(
      emptyState,
      makeFormData({ accountTypeCategoryId: "5" })
    );
    expect(deleted.success).toBe(false);
    expect(deleted.message).toMatch(/protected/i);

    const [row] = await db
      .select({ name: accountTypeCategories.accountTypeCategory })
      .from(accountTypeCategories)
      .where(eq(accountTypeCategories.accountTypeCategoryId, 5));
    expect(row.name).toBe("Current Liability");
  });
});
