import { describe, it, expect } from "vitest";
import {
  balanceTransferFormSchema,
  checkBalanceTransferLinks,
  type BalanceTransferLinkFacts,
} from "@/lib/validations/balance-transfer";

const validForm = {
  accountId: "9",
  transferTransactionId: "100",
  feeTransactionId: "101",
  promoEndDate: "2027-11-10",
  promoApr: "0",
};

const fieldsOf = (input: Record<string, unknown>) => {
  const result = balanceTransferFormSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((i) => [String(i.path[0]), i.message])
  );
};

describe("balanceTransferFormSchema", () => {
  it("accepts a transfer with a fee", () => {
    expect(balanceTransferFormSchema.safeParse(validForm).success).toBe(true);
  });

  it("accepts a transfer with no separate fee", () => {
    const noFee: Partial<typeof validForm> = { ...validForm };
    delete noFee.feeTransactionId;
    expect(balanceTransferFormSchema.safeParse(noFee).success).toBe(true);
    expect(
      balanceTransferFormSchema.safeParse({ ...validForm, feeTransactionId: "" }).success
    ).toBe(true);
  });

  it.each(["0", "3.99", "29.999", "100", "100.000"])("accepts an APR of %s", (apr) => {
    expect(balanceTransferFormSchema.safeParse({ ...validForm, promoApr: apr }).success).toBe(
      true
    );
  });

  it.each(["-1", "100.001", "101", "3.9999", "abc", "1e2"])(
    "rejects an APR of %s with an authored message",
    (apr) => {
      expect(fieldsOf({ ...validForm, promoApr: apr }).promoApr).toBe(
        "APR must be between 0 and 100, with at most 3 decimal places"
      );
    }
  );

  it("rejects a fee that is the posting itself", () => {
    expect(fieldsOf({ ...validForm, feeTransactionId: "100" }).feeTransactionId).toBe(
      "The fee can't be the transfer's own posting"
    );
  });

  it.each(["2027-02-30", "2027-2-1", "next year"])(
    "rejects an end date of %s",
    (date) => {
      expect(fieldsOf({ ...validForm, promoEndDate: date }).promoEndDate).toBe(
        "Promo end date must be a valid date in YYYY-MM-DD format"
      );
    }
  );

  it("authors a message for every omitted field, rather than Zod's own", () => {
    expect(fieldsOf({})).toEqual({
      accountId: "Account is required",
      transferTransactionId: "Pick the transfer's posting",
      promoEndDate: "Promo end date is required",
      promoApr: "APR is required",
    });
  });

  it("rejects malformed IDs", () => {
    expect(fieldsOf({ ...validForm, transferTransactionId: "1.5" })).toEqual({
      transferTransactionId: "Invalid transfer posting",
    });
    expect(fieldsOf({ ...validForm, feeTransactionId: "Infinity" })).toEqual({
      feeTransactionId: "Invalid fee transaction",
    });
  });
});

describe("checkBalanceTransferLinks", () => {
  const facts = (overrides: Partial<BalanceTransferLinkFacts> = {}): BalanceTransferLinkFacts => ({
    accountId: 9,
    accountCategoryId: 5,
    posting: {
      accountId: 9,
      amount: -6000,
      transactionDate: "2026-03-01",
      linkedToOtherTransfer: null,
    },
    feeRequested: true,
    fee: {
      accountId: 9,
      amount: -180,
      transactionDate: "2026-03-04",
      linkedToOtherTransfer: null,
    },
    promoEndDate: "2027-09-01",
    ...overrides,
  });

  const messages = (f: BalanceTransferLinkFacts) =>
    checkBalanceTransferLinks(f).map((p) => [p.field, p.message]);

  it("accepts a valid link", () => {
    expect(checkBalanceTransferLinks(facts())).toEqual([]);
  });

  it("accepts no separate fee", () => {
    expect(checkBalanceTransferLinks(facts({ feeRequested: false, fee: null }))).toEqual([]);
  });

  it("accepts a non-current liability account", () => {
    expect(checkBalanceTransferLinks(facts({ accountCategoryId: 6 }))).toEqual([]);
  });

  it("rejects an asset account, and says nothing else", () => {
    expect(messages(facts({ accountCategoryId: 1, posting: null }))).toEqual([
      ["accountId", "Balance transfers can only be recorded on liability accounts."],
    ]);
  });

  it("rejects a missing account", () => {
    expect(messages(facts({ accountCategoryId: null }))).toEqual([
      ["accountId", "Account not found"],
    ]);
  });

  it("rejects a posting on another account, or one that doesn't exist", () => {
    const expected = [["transferTransactionId", "Pick a transaction on this account."]];
    expect(
      messages(facts({ posting: { ...facts().posting!, accountId: 3 } }))
    ).toEqual(expected);
    expect(messages(facts({ posting: null }))).toEqual(expected);
  });

  it("rejects a posting that doesn't add debt", () => {
    for (const amount of [0, 6000]) {
      expect(messages(facts({ posting: { ...facts().posting!, amount } }))).toEqual([
        [
          "transferTransactionId",
          "Pick a transaction that added debt to this card. A transfer's posting has a negative amount.",
        ],
      ]);
    }
  });

  it("rejects a posting already linked to another transfer", () => {
    expect(
      messages(facts({ posting: { ...facts().posting!, linkedToOtherTransfer: 4 } }))
    ).toEqual([
      ["transferTransactionId", "That transaction is already linked to another balance transfer."],
    ]);
  });

  it("rejects an end date on or before the posting date", () => {
    for (const promoEndDate of ["2026-03-01", "2026-02-28"]) {
      expect(messages(facts({ promoEndDate }))).toEqual([
        ["promoEndDate", "The promo end date must be after the transfer's posting date."],
      ]);
    }
    expect(checkBalanceTransferLinks(facts({ promoEndDate: "2026-03-02" }))).toEqual([]);
  });

  it("rejects a fee on a different account, or one that doesn't exist", () => {
    const expected = [
      ["feeTransactionId", "The fee must be a transaction on the same card as the transfer."],
    ];
    expect(messages(facts({ fee: { ...facts().fee!, accountId: 3 } }))).toEqual(expected);
    expect(messages(facts({ fee: null }))).toEqual(expected);
  });

  it("rejects a fee already linked to another transfer", () => {
    expect(messages(facts({ fee: { ...facts().fee!, linkedToOtherTransfer: 4 } }))).toEqual([
      ["feeTransactionId", "That fee transaction is already linked to another balance transfer."],
    ]);
  });

  it("reports every problem at once", () => {
    expect(
      checkBalanceTransferLinks(
        facts({
          posting: { ...facts().posting!, linkedToOtherTransfer: 4 },
          fee: { ...facts().fee!, accountId: 3 },
          promoEndDate: "2026-01-01",
        })
      ).map((p) => p.field)
    ).toEqual(["transferTransactionId", "promoEndDate", "feeTransactionId"]);
  });
});
