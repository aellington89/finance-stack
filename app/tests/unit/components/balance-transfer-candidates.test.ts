import { describe, it, expect } from "vitest";
import {
  candidateLabel,
  feeOptions,
  postingOptions,
} from "@/components/accounts/balance-transfer-candidates";
import type { BalanceTransferCandidate } from "@/lib/queries/balance-transfers";

const c = (
  transactionId: number,
  transactionDate: string,
  amount: number,
  overrides: Partial<BalanceTransferCandidate> = {}
): BalanceTransferCandidate => ({
  transactionId,
  transactionDate,
  description: `txn ${transactionId}`,
  amount,
  transactionTypeId: 2, // Expense
  linkedBalanceTransferId: null,
  ...overrides,
});

const INTERNAL = 1;
const EXTERNAL = 8;

describe("postingOptions", () => {
  it("lists transfer types first, newest first within each group", () => {
    const options = postingOptions(
      [
        c(1, "2026-05-01", -40),
        c(2, "2026-01-10", -6000, { transactionTypeId: INTERNAL }),
        c(3, "2026-06-01", -12),
        c(4, "2025-08-01", -900, { transactionTypeId: EXTERNAL }),
      ],
      null
    );
    expect(options.map((o) => o.transactionId)).toEqual([2, 4, 3, 1]);
  });

  it("breaks a same-day tie by newest id", () => {
    const options = postingOptions(
      [c(5, "2026-05-01", -1), c(9, "2026-05-01", -1)],
      null
    );
    expect(options.map((o) => o.transactionId)).toEqual([9, 5]);
  });

  it("leaves out credits, and anything linked to another transfer", () => {
    const options = postingOptions(
      [
        c(1, "2026-05-01", 250),
        c(2, "2026-05-02", -100, { linkedBalanceTransferId: 7 }),
        c(3, "2026-05-03", -100),
      ],
      null
    );
    expect(options.map((o) => o.transactionId)).toEqual([3]);
  });

  it("keeps the edited transfer's own posting selectable", () => {
    const options = postingOptions(
      [c(2, "2026-05-02", -100, { linkedBalanceTransferId: 7 })],
      7
    );
    expect(options.map((o) => o.transactionId)).toEqual([2]);
  });
});

describe("feeOptions", () => {
  const candidates = [
    c(1, "2026-02-28", -10),
    c(2, "2026-03-01", -6000, { transactionTypeId: INTERNAL }),
    c(3, "2026-03-01", -15),
    c(4, "2026-03-04", -180),
    c(5, "2026-04-01", -22),
    c(6, "2026-03-02", -50, { linkedBalanceTransferId: 7 }),
  ];

  it("offers nothing until a posting is picked", () => {
    expect(feeOptions(candidates, null, null)).toEqual([]);
    expect(feeOptions(candidates, 999, null)).toEqual([]);
  });

  it("offers transactions on or after the posting date, nearest first, minus the posting", () => {
    expect(feeOptions(candidates, 2, null).map((o) => o.transactionId)).toEqual([3, 4, 5]);
  });

  it("keeps the edited transfer's own fee selectable", () => {
    expect(feeOptions(candidates, 2, 7).map((o) => o.transactionId)).toEqual([3, 6, 4, 5]);
  });

  it("offers an already-linked fee of the edited transfer even if it is not a debit", () => {
    const withCredit = [...candidates, c(8, "2026-03-05", 5, { linkedBalanceTransferId: 7 })];
    expect(feeOptions(withCredit, 2, 7).map((o) => o.transactionId)).toContain(8);
    expect(feeOptions(withCredit, 2, null).map((o) => o.transactionId)).not.toContain(8);
  });
});

describe("candidateLabel", () => {
  it("shows the date, description and absolute amount", () => {
    expect(
      candidateLabel(c(2, "2026-03-01", -6000, { description: "Balance transfer from Visa" }))
    ).toBe("2026-03-01 · Balance transfer from Visa · $6,000.00");
  });
});
