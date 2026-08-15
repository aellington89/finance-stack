import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as accountActions from "@/lib/actions/account";
import * as transactionActions from "@/lib/actions/transaction";
import * as categoryActions from "@/lib/actions/categories";
import type { ActionState } from "@/lib/actions/utils";

/**
 * The executable form of Issue #179's first acceptance criterion — "a
 * checklist/table of every server action with its validation status, all
 * green".
 *
 * A markdown table alone rots the moment someone adds a nineteenth action, so
 * the registry below is checked against two things: the modules' actual
 * exports, and the table in docs/input-validation.md. Adding an action without
 * covering it here, or without listing it there, fails CI.
 *
 * `lib/actions/auth.ts` is deliberately out of scope: `authenticate` takes raw
 * credentials by design and Auth.js owns their handling (one generic message
 * for unknown-user and wrong-password alike), and `signOutAction` accepts no
 * input at all. It is also not importable here — it pulls `AuthError` from
 * `next-auth`, whose internals need the `next/server` runtime that the
 * integration project does not provide. Credential handling is covered by
 * tests/integration/auth/verify-credentials.test.ts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = resolve(HERE, "../../../../docs/input-validation.md");

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface ActionCase {
  action: Action;
  /** A payload whose non-ID fields are valid, so an ID guard is what trips. */
  valid: Record<string, string>;
  /** Fields replaced with a malformed ID to build the hostile payload. */
  idFields: string[];
}

const TXN_FIELDS = {
  transactionDescription: "Contract Probe",
  transactionDate: "2026-01-01",
  amount: "1.00",
  accountId: "1",
  transactionTypeId: "1",
  transactionCategoryId: "1",
};

const TXN_ID_FIELDS = ["accountId", "transactionTypeId", "transactionCategoryId"];

const REGISTRY: Record<string, ActionCase> = {
  // ── transactions ──
  submitTransaction: {
    action: transactionActions.submitTransaction,
    valid: TXN_FIELDS,
    idFields: TXN_ID_FIELDS,
  },
  updateTransaction: {
    action: transactionActions.updateTransaction,
    valid: { transactionId: "1", ...TXN_FIELDS },
    idFields: ["transactionId", ...TXN_ID_FIELDS],
  },
  deleteTransaction: {
    action: transactionActions.deleteTransaction,
    valid: { transactionId: "1" },
    idFields: ["transactionId"],
  },

  // ── accounts ──
  createAccount: {
    action: accountActions.createAccount,
    valid: { accountName: "Contract Probe", accountTypeId: "1" },
    idFields: ["accountTypeId"],
  },
  updateAccount: {
    action: accountActions.updateAccount,
    valid: { accountId: "1", accountName: "Contract Probe", accountTypeId: "1" },
    idFields: ["accountId", "accountTypeId"],
  },
  deleteAccount: {
    action: accountActions.deleteAccount,
    valid: { accountId: "1" },
    idFields: ["accountId"],
  },

  // ── transaction categories ──
  createTransactionCategory: {
    action: categoryActions.createTransactionCategory,
    valid: { name: "Contract Probe" },
    idFields: [],
  },
  updateTransactionCategory: {
    action: categoryActions.updateTransactionCategory,
    valid: { transactionCategoryId: "1", name: "Contract Probe" },
    idFields: ["transactionCategoryId"],
  },
  deleteTransactionCategory: {
    action: categoryActions.deleteTransactionCategory,
    valid: { transactionCategoryId: "1" },
    idFields: ["transactionCategoryId"],
  },

  // ── transaction types ──
  // createTransactionType was removed in Issue #109 and restored in Issue #87,
  // now admin-only and reachable from /settings/admin rather than
  // /settings/categories. The contract below is unchanged by that: the role
  // check runs first, and the integration session is an admin, so what these
  // cases exercise is still the validation.
  createTransactionType: {
    action: categoryActions.createTransactionType,
    valid: { name: "Contract Probe" },
    idFields: [],
  },
  updateTransactionType: {
    action: categoryActions.updateTransactionType,
    valid: { transactionTypeId: "1", name: "Contract Probe" },
    idFields: ["transactionTypeId"],
  },
  deleteTransactionType: {
    action: categoryActions.deleteTransactionType,
    valid: { transactionTypeId: "1" },
    idFields: ["transactionTypeId"],
  },

  // ── account type categories ──
  createAccountTypeCategory: {
    action: categoryActions.createAccountTypeCategory,
    valid: { name: "Contract Probe" },
    idFields: [],
  },
  updateAccountTypeCategory: {
    action: categoryActions.updateAccountTypeCategory,
    valid: { accountTypeCategoryId: "1", name: "Contract Probe" },
    idFields: ["accountTypeCategoryId"],
  },
  deleteAccountTypeCategory: {
    action: categoryActions.deleteAccountTypeCategory,
    valid: { accountTypeCategoryId: "1" },
    idFields: ["accountTypeCategoryId"],
  },

  // ── account types ──
  createAccountType: {
    action: categoryActions.createAccountType,
    valid: { name: "Contract Probe", accountTypeCategoryId: "1" },
    idFields: ["accountTypeCategoryId"],
  },
  updateAccountType: {
    action: categoryActions.updateAccountType,
    valid: { accountTypeId: "1", name: "Contract Probe", accountTypeCategoryId: "1" },
    idFields: ["accountTypeId", "accountTypeCategoryId"],
  },
  deleteAccountType: {
    action: categoryActions.deleteAccountType,
    valid: { accountTypeId: "1" },
    idFields: ["accountTypeId"],
  },
};

/**
 * Shapes that must never reach the client. The SQLSTATEs and the drizzle
 * message preamble are what a caught driver error looks like; `params:` is the
 * line drizzle appends carrying every bound value (see docs/observability.md).
 */
const DRIVER_TEXT =
  /22P02|22003|23503|23514|SQLSTATE|invalid input syntax|out of range|Failed query|params:|relation "|column "/i;

/** The three shapes the pre-#179 `!id || id <= 0` guard accepted. */
const MALFORMED_IDS = ["1.5", "Infinity", "2147483648"];

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

function exportedActionNames(module: object): string[] {
  return Object.entries(module)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);
}

const emptyState: ActionState = { success: false, errors: {}, message: "" };

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => consoleError.mockClear());
afterAll(() => consoleError.mockRestore());

function expectCleanRejection(result: ActionState) {
  expect(result.success).toBe(false);

  const surfaced = [result.message, ...Object.values(result.errors).flat()];
  for (const text of surfaced) {
    expect(text).not.toMatch(DRIVER_TEXT);
  }

  // Something has to be said, or the form renders a silent failure.
  expect(result.message.length + Object.keys(result.errors).length).toBeGreaterThan(0);
}

describe("server action validation contract", () => {
  it("covers every action the three modules export", () => {
    const exported = [
      ...exportedActionNames(accountActions),
      ...exportedActionNames(transactionActions),
      ...exportedActionNames(categoryActions),
    ].sort();

    // Fails when an action is added without a row above. Add the row (and a
    // line in docs/input-validation.md) rather than relaxing this.
    expect(Object.keys(REGISTRY).sort()).toEqual(exported);
  });

  it("lists every action in the docs/input-validation.md table", () => {
    const doc = readFileSync(DOC_PATH, "utf8");

    // Scoped to the checklist section: the guide has other tables whose first
    // cell is a backticked call (the error-message vocabulary names
    // actionFailure()), and they are not part of the inventory.
    const section = doc.split("## The validation checklist")[1]?.split("\n## ")[0];
    expect(section, "checklist section not found in docs/input-validation.md").toBeDefined();

    const documented = [...section.matchAll(/^\|\s*`(\w+)\(\)`/gm)].map((m) => m[1]);

    expect(documented.sort()).toEqual(Object.keys(REGISTRY).sort());
  });

  describe.each(Object.entries(REGISTRY))("%s", (name, testCase) => {
    it("rejects an empty payload without driver text", async () => {
      const result = await testCase.action(emptyState, new FormData());
      expectCleanRejection(result);
    });

    it("rejects an empty payload before touching the database", async () => {
      await testCase.action(emptyState, new FormData());
      // A log line here would mean the action reached actionFailure(), i.e. it
      // let the payload through to the driver and cleaned up afterwards.
      expect(consoleError).not.toHaveBeenCalled();
    });

    // The create-by-name actions read no ID from the form; the empty-payload
    // cases above are their whole surface.
    if (testCase.idFields.length === 0) return;

    it.each(MALFORMED_IDS)(
      "rejects %s in an ID field, before touching the database",
      async (badId) => {
        for (const field of testCase.idFields) {
          const result = await testCase.action(
            emptyState,
            makeFormData({ ...testCase.valid, [field]: badId })
          );

          expectCleanRejection(result);
          expect(consoleError).not.toHaveBeenCalled();
        }
      }
    );
  });
});

/**
 * The issue's second acceptance criterion, stated on its own so it is findable:
 * before this change, deleteAccount's in-use pre-check ran outside the try with
 * an unvalidated ID, so this payload threw 22P02 out of the action — a 500,
 * not a validation error.
 */
describe("deleteAccount with a malformed ID (acceptance criterion)", () => {
  it("returns a validation error rather than throwing", async () => {
    const result = await accountActions.deleteAccount(
      emptyState,
      makeFormData({ accountId: "1.5" })
    );

    expect(result).toEqual({
      success: false,
      errors: {},
      message: "Invalid account ID",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

