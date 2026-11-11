import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BalanceTransfersCard } from "@/components/accounts/balance-transfers-card";
import type {
  AccountBalanceTransfer,
  BalanceTransferCandidate,
} from "@/lib/queries/balance-transfers";
import type { ActionState } from "@/lib/actions/utils";

// Issue #417. All figures synthetic.

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const ok = () =>
  vi.fn<Action>(async () => ({ success: true, errors: {}, message: "" }));

const transfer = (overrides: Partial<AccountBalanceTransfer> = {}): AccountBalanceTransfer => ({
  balanceTransferId: 1,
  transferTransactionId: 100,
  postingDate: "2026-03-01",
  postingDescription: "Balance transfer",
  postingAmount: -6000,
  sourceAccountName: "Visa",
  feeTransactionId: 101,
  feeDate: "2026-03-04",
  feeDescription: "Balance transfer fee",
  feeAmount: -180,
  promoEndDate: "2027-09-01",
  promoApr: 0,
  isActive: true,
  ...overrides,
});

const candidates: BalanceTransferCandidate[] = [
  {
    transactionId: 100,
    transactionDate: "2026-03-01",
    description: "Balance transfer",
    amount: -6000,
    transactionTypeId: 1,
    linkedBalanceTransferId: 1,
  },
  {
    transactionId: 101,
    transactionDate: "2026-03-04",
    description: "Balance transfer fee",
    amount: -180,
    transactionTypeId: 2,
    linkedBalanceTransferId: 1,
  },
  {
    transactionId: 102,
    transactionDate: "2026-05-01",
    description: "Groceries",
    amount: -60,
    transactionTypeId: 2,
    linkedBalanceTransferId: null,
  },
];

const renderCard = (
  transfers: AccountBalanceTransfer[],
  actions: Partial<Record<"createAction" | "updateAction" | "deleteAction", ReturnType<typeof ok>>> = {}
) =>
  render(
    <BalanceTransfersCard
      accountId={9}
      transfers={transfers}
      candidates={candidates}
      createAction={actions.createAction ?? ok()}
      updateAction={actions.updateAction ?? ok()}
      deleteAction={actions.deleteAction ?? ok()}
    />
  );

describe("BalanceTransfersCard", () => {
  it("explains the workflow when nothing is recorded", () => {
    renderCard([]);
    expect(screen.getByText(/No balance transfers recorded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add balance transfer" })).toBeInTheDocument();
  });

  it("lists a transfer by amount and source, with its terms and fee", () => {
    renderCard([transfer()]);
    const row = screen.getByTestId("balance-transfer-1");
    expect(within(row).getByText("$6,000.00 from Visa")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(row).toHaveTextContent("0% until Sep 1, 2027");
    expect(row).toHaveTextContent("posted Mar 1, 2026");
    expect(row).toHaveTextContent("fee $180.00");
  });

  it("names an untracked source External, and a missing fee as unlinked", () => {
    renderCard([
      transfer({ sourceAccountName: null, feeTransactionId: null, feeAmount: null, feeDate: null, feeDescription: null, isActive: false, promoApr: 3.99 }),
    ]);
    const row = screen.getByTestId("balance-transfer-1");
    expect(within(row).getByText("$6,000.00 from External")).toBeInTheDocument();
    expect(within(row).getByText("Ended")).toBeInTheDocument();
    expect(row).toHaveTextContent("3.99% until Sep 1, 2027");
    expect(row).toHaveTextContent("no fee linked");
  });

  it("opens an empty add dialog, with the fee picker waiting on the posting", async () => {
    const user = userEvent.setup();
    renderCard([]);
    await user.click(screen.getByRole("button", { name: "Add balance transfer" }));

    const dialog = await screen.findByRole("dialog", { name: "Add balance transfer" });
    expect(within(dialog).getByLabelText("Transfer posting *")).toHaveValue("");
    expect(within(dialog).getByPlaceholderText("Pick the posting first")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Promo APR (%) *")).toHaveValue("0");
  });

  it("opens the edit dialog prefilled with the transfer's links and terms", async () => {
    const user = userEvent.setup();
    renderCard([transfer({ promoApr: 3.99 })]);
    await user.click(
      screen.getByRole("button", { name: "Edit balance transfer of $6,000.00 from Visa" })
    );

    const dialog = await screen.findByRole("dialog", { name: "Edit balance transfer" });
    expect(within(dialog).getByLabelText("Transfer posting *")).toHaveValue(
      "2026-03-01 · Balance transfer · $6,000.00"
    );
    expect(within(dialog).getByLabelText("Fee")).toHaveValue(
      "2026-03-04 · Balance transfer fee · $180.00"
    );
    expect(within(dialog).getByLabelText("Promo end date *")).toHaveValue("2027-09-01");
    expect(within(dialog).getByLabelText("Promo APR (%) *")).toHaveValue("3.99");

    const form = dialog.querySelector("form")!;
    const hidden = Object.fromEntries(
      Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).map((i) => [
        i.name,
        i.value,
      ])
    );
    expect(hidden).toMatchObject({
      accountId: "9",
      balanceTransferId: "1",
      transferTransactionId: "100",
      feeTransactionId: "101",
    });
  });

  it("shows field errors returned by the action", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn<Action>(
      async () => ({
        success: false,
        errors: { promoEndDate: ["The promo end date must be after the transfer's posting date."] },
        message: "Validation failed",
      })
    );
    renderCard([transfer()], { updateAction });
    await user.click(
      screen.getByRole("button", { name: "Edit balance transfer of $6,000.00 from Visa" })
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(
      await within(dialog).findByText("The promo end date must be after the transfer's posting date.")
    ).toBeInTheDocument();
    expect(updateAction).toHaveBeenCalledTimes(1);
  });

  it("confirms a delete, saying the transactions stay", async () => {
    const user = userEvent.setup();
    const deleteAction = ok();
    renderCard([transfer()], { deleteAction });
    await user.click(
      screen.getByRole("button", { name: "Delete balance transfer of $6,000.00 from Visa" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Its posting and fee stay in the ledger");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledTimes(1));
    expect(deleteAction.mock.calls[0][1].get("balanceTransferId")).toBe("1");
  });
});
