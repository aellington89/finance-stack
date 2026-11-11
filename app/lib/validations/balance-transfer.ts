import { z } from "zod/v4";
import { isEntityId } from "@/lib/validations/id";
import { isValidIsoDate } from "@/lib/validations/date-range";
import { LIABILITY_CATEGORY_IDS } from "@/lib/queries/liability-categories";

/**
 * Validation for the balance-transfer actions (Issue #417), in two halves.
 *
 * `balanceTransferFormSchema` checks what the form alone can answer: the shape
 * of every field, and that the fee is not the posting itself. Each
 * `z.string(...)` carries an authored message (docs/input-validation.md).
 *
 * `checkBalanceTransferLinks` checks what needs the database: where the two
 * picked transactions live and whether they are already linked. The action
 * reads those facts inside its transaction and hands them over. The rules
 * themselves are a pure function, so every message is unit-tested without a
 * database.
 */

const APR_MESSAGE = "APR must be between 0 and 100, with at most 3 decimal places";

export const balanceTransferFormSchema = z
  .object({
    accountId: z
      .string("Account is required")
      .min(1, "Account is required")
      .refine(isEntityId, { message: "Invalid account" }),
    transferTransactionId: z
      .string("Pick the transfer's posting")
      .min(1, "Pick the transfer's posting")
      .refine(isEntityId, { message: "Invalid transfer posting" }),
    // Absent or empty means "No separate fee".
    feeTransactionId: z
      .string("Invalid fee transaction")
      .optional()
      .refine((val) => !val || isEntityId(val), {
        message: "Invalid fee transaction",
      }),
    promoEndDate: z
      .string("Promo end date is required")
      .min(1, "Promo end date is required")
      .refine(isValidIsoDate, {
        message: "Promo end date must be a valid date in YYYY-MM-DD format",
      }),
    // numeric(6,3) with a 0–100 CHECK. Negative values fail the pattern.
    promoApr: z
      .string("APR is required")
      .min(1, "APR is required")
      .regex(/^\d{1,3}(\.\d{1,3})?$/, APR_MESSAGE)
      .refine((val) => Number(val) <= 100, { message: APR_MESSAGE }),
  })
  .refine(
    (data) =>
      !data.feeTransactionId ||
      data.feeTransactionId !== data.transferTransactionId,
    {
      message: "The fee can't be the transfer's own posting",
      path: ["feeTransactionId"],
    }
  );

export type BalanceTransferFormData = z.infer<typeof balanceTransferFormSchema>;

/** A picked transaction as the action finds it. `null` when it doesn't exist. */
export interface LinkedTransactionFacts {
  accountId: number;
  amount: number;
  transactionDate: string;
  /**
   * The balance transfer this transaction is already linked to, as posting or
   * as fee, other than the one being edited. `null` when it is free.
   */
  linkedToOtherTransfer: number | null;
}

export interface BalanceTransferLinkFacts {
  /** The account the form is for, i.e. the account page it was submitted from. */
  accountId: number;
  /** That account's account_type_category_id, or `null` if it doesn't exist. */
  accountCategoryId: number | null;
  posting: LinkedTransactionFacts | null;
  /** Whether the form named a fee at all. */
  feeRequested: boolean;
  fee: LinkedTransactionFacts | null;
  promoEndDate: string;
}

export interface BalanceTransferLinkProblem {
  field: "accountId" | "transferTransactionId" | "feeTransactionId" | "promoEndDate";
  message: string;
}

const isLiabilityCategory = (id: number): boolean =>
  (LIABILITY_CATEGORY_IDS as readonly number[]).includes(id);

/**
 * The rules that need the database, as authored messages keyed by field.
 * Returns an empty list when the link is valid.
 *
 * An account problem is returned alone: there is nothing useful to say about
 * the picked transactions when the account itself is wrong.
 */
export function checkBalanceTransferLinks(
  facts: BalanceTransferLinkFacts
): BalanceTransferLinkProblem[] {
  if (facts.accountCategoryId === null) {
    return [{ field: "accountId", message: "Account not found" }];
  }
  if (!isLiabilityCategory(facts.accountCategoryId)) {
    return [
      {
        field: "accountId",
        message: "Balance transfers can only be recorded on liability accounts.",
      },
    ];
  }

  const problems: BalanceTransferLinkProblem[] = [];
  const { posting, fee } = facts;

  if (!posting || posting.accountId !== facts.accountId) {
    problems.push({
      field: "transferTransactionId",
      message: "Pick a transaction on this account.",
    });
  } else if (posting.amount >= 0) {
    problems.push({
      field: "transferTransactionId",
      message:
        "Pick a transaction that added debt to this card. A transfer's posting has a negative amount.",
    });
  } else if (posting.linkedToOtherTransfer !== null) {
    problems.push({
      field: "transferTransactionId",
      message: "That transaction is already linked to another balance transfer.",
    });
  }

  if (posting && facts.promoEndDate <= posting.transactionDate) {
    problems.push({
      field: "promoEndDate",
      message: "The promo end date must be after the transfer's posting date.",
    });
  }

  if (facts.feeRequested) {
    if (!fee || fee.accountId !== facts.accountId) {
      problems.push({
        field: "feeTransactionId",
        message: "The fee must be a transaction on the same card as the transfer.",
      });
    } else if (fee.linkedToOtherTransfer !== null) {
      problems.push({
        field: "feeTransactionId",
        message: "That fee transaction is already linked to another balance transfer.",
      });
    }
  }

  return problems;
}
