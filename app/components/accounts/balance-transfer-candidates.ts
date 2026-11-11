import type { BalanceTransferCandidate } from "@/lib/queries/balance-transfers";
import {
  EXTERNAL_TRANSFER_TYPE,
  INTERNAL_TRANSFER_TYPE,
} from "@/lib/constants/reference-ids";
import { formatCurrency } from "@/lib/format/financial";

/**
 * What the balance-transfer dialog's two pickers offer (Issue #417). Pure, so
 * the ordering and the "already linked" rules are unit-tested rather than
 * left to a rendered combobox.
 *
 * Both pickers draw on the same list, getBalanceTransferCandidates(): the
 * card's postings that added debt, each marked with the transfer it is already
 * linked to, if any. `editingId` is the transfer the dialog is editing (null
 * when adding). That transfer's own links stay selectable, and anything linked
 * to a different transfer does not.
 */

const TRANSFER_TYPE_IDS: readonly number[] = [
  INTERNAL_TRANSFER_TYPE.id,
  EXTERNAL_TRANSFER_TYPE.id,
];

const isFree = (c: BalanceTransferCandidate, editingId: number | null) =>
  c.linkedBalanceTransferId === null || c.linkedBalanceTransferId === editingId;

const isTransferType = (c: BalanceTransferCandidate) =>
  TRANSFER_TYPE_IDS.includes(c.transactionTypeId);

/**
 * Candidates for the transfer's posting: unlinked postings that added debt,
 * transfer types first and newest first within each group.
 */
export function postingOptions(
  candidates: readonly BalanceTransferCandidate[],
  editingId: number | null
): BalanceTransferCandidate[] {
  return candidates
    .filter((c) => c.amount < 0 && isFree(c, editingId))
    .sort(
      (a, b) =>
        Number(isTransferType(b)) - Number(isTransferType(a)) ||
        b.transactionDate.localeCompare(a.transactionDate) ||
        b.transactionId - a.transactionId
    );
}

/**
 * Candidates for the fee, once a posting is picked: the card's other
 * debt-adding postings dated on or after it, nearest first. A fee posts with
 * or shortly after the transfer, so the right one is usually at the top.
 * Nothing is offered until a posting is picked.
 */
export function feeOptions(
  candidates: readonly BalanceTransferCandidate[],
  postingId: number | null,
  editingId: number | null
): BalanceTransferCandidate[] {
  const posting = candidates.find((c) => c.transactionId === postingId);
  if (!posting) return [];
  return candidates
    .filter(
      (c) =>
        c.transactionId !== posting.transactionId &&
        c.transactionDate >= posting.transactionDate &&
        (c.amount < 0 || c.linkedBalanceTransferId === editingId) &&
        isFree(c, editingId)
    )
    .sort(
      (a, b) =>
        a.transactionDate.localeCompare(b.transactionDate) ||
        a.transactionId - b.transactionId
    );
}

/**
 * The text a picker shows and filters on, e.g.
 * "2026-03-14 · Balance transfer from Visa · $6,000.00". Typing any part of
 * the date, description or amount narrows the list.
 */
export function candidateLabel(c: BalanceTransferCandidate): string {
  return `${c.transactionDate} · ${c.description} · ${formatCurrency(Math.abs(c.amount))}`;
}
