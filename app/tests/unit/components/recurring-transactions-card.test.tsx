import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecurringTransactionsCard } from "@/components/transactions/recurring-transactions-card";
import type { RecurringTransactionRow } from "@/lib/queries/recurring-transactions";
import type { ActionState } from "@/lib/actions/utils";

// Issue #135. All figures synthetic.

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const ok = () => vi.fn<Action>(async () => ({ success: true, errors: {}, message: "" }));

const template = (overrides: Partial<RecurringTransactionRow> = {}): RecurringTransactionRow => ({
  recurringTransactionId: 4,
  transactionDescription: "Rent",
  amount: "-1450.00",
  accountId: 1,
  accountName: "Checking",
  accountClosedDate: null,
  relatedAccountId: null,
  relatedAccountName: null,
  transactionTypeId: 2,
  transactionType: "Expense",
  transactionCategoryId: 3,
  transactionCategory: "Housing",
  cadence: "monthly",
  intervalCount: 1,
  anchorDate: "2026-01-01",
  nextRunDate: "2026-12-01",
  endDate: null,
  isActive: true,
  ...overrides,
});

const accounts = [
  { id: 1, name: "Checking" },
  { id: 2, name: "Savings" },
];
const types = [{ id: 2, name: "Expense" }];
const categories = [{ id: 3, name: "Housing" }];

// Postgres's CURRENT_DATE as the page read it: the add dialog's default next
// date and the preview's "today".
const TODAY = "2026-11-14";

const renderCard = (
  templates: RecurringTransactionRow[],
  actions: Partial<Record<"createAction" | "updateAction" | "deleteAction", ReturnType<typeof ok>>> = {}
) =>
  render(
    <RecurringTransactionsCard
      templates={templates}
      accounts={accounts}
      types={types}
      categories={categories}
      today={TODAY}
      createAction={actions.createAction ?? ok()}
      updateAction={actions.updateAction ?? ok()}
      deleteAction={actions.deleteAction ?? ok()}
    />
  );

const hiddenFields = (dialog: HTMLElement) =>
  Object.fromEntries(
    Array.from(dialog.querySelectorAll<HTMLInputElement>('form input[type="hidden"]')).map((i) => [i.name, i.value])
  );

describe("RecurringTransactionsCard", () => {
  it("explains the feature when there are none (AC15)", () => {
    renderCard([]);
    expect(screen.getByText(/No recurring transactions yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add recurring transaction" })).toBeInTheDocument();
  });

  it("lists a template with its account, amount, schedule, next date and status (AC16)", () => {
    renderCard([template({ relatedAccountId: 2, relatedAccountName: "Savings", endDate: "2027-06-01" })]);
    const row = screen.getByTestId("recurring-4");
    expect(within(row).getByText("Rent")).toBeInTheDocument();
    expect(row).toHaveTextContent("Checking");
    expect(row).toHaveTextContent("↔ Savings");
    expect(row).toHaveTextContent("-$1,450.00");
    expect(row).toHaveTextContent("Monthly on the 1st");
    expect(row).toHaveTextContent("until Jun 1, 2027");
    expect(row).toHaveTextContent("Dec 1, 2026");
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it.each<[Partial<RecurringTransactionRow>, string]>([
    [{ isActive: false }, "Paused"],
    [{ isActive: false, accountClosedDate: "2026-11-01" }, "Paused — account closed"],
    [{ endDate: "2026-11-30" }, "Ended"],
  ])("shows %o as %s, with no next date (AC16)", (overrides, label) => {
    renderCard([template(overrides)]);
    const row = screen.getByTestId("recurring-4");
    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(row).not.toHaveTextContent("Dec 1, 2026");
    expect(row).toHaveTextContent("—");
  });

  it("shows an active template on a closed account as Account closed, with its next date (AC16)", () => {
    renderCard([template({ accountClosedDate: "2026-12-15" })]);
    const row = screen.getByTestId("recurring-4");
    expect(within(row).getByText("Account closed")).toBeInTheDocument();
    expect(row).toHaveTextContent("Dec 1, 2026");
  });

  it("opens an empty add dialog, defaulting to monthly from today (AC17)", async () => {
    const user = userEvent.setup();
    renderCard([]);
    await user.click(screen.getByRole("button", { name: "Add recurring transaction" }));

    const dialog = await screen.findByRole("dialog", { name: "Add recurring transaction" });
    expect(within(dialog).getByLabelText("Description *")).toHaveValue("");
    expect(within(dialog).getByLabelText("Next date *")).toHaveValue("2026-11-14");
    expect(within(dialog).getByLabelText("Number of units between dates")).toHaveValue("1");
    expect(within(dialog).queryByLabelText("Active")).not.toBeInTheDocument();
    expect(hiddenFields(dialog)).toMatchObject({ cadence: "monthly" });
    expect(hiddenFields(dialog)).not.toHaveProperty("recurringTransactionId");
    expect(hiddenFields(dialog)).not.toHaveProperty("loadedNextRunDate");
    expect(dialog).toHaveTextContent("For a transfer, add one recurring transaction for each account");
    // Due today, so the save adds it at once.
    expect(within(dialog).getByTestId("rt-preview")).toHaveTextContent(
      "1 date is on or before today, and is added when you save. Next: Dec 14, 2026 · Jan 14, 2027 · Feb 14, 2027"
    );
  });

  it("updates the preview as the schedule is typed (AC18)", async () => {
    const user = userEvent.setup();
    renderCard([]);
    await user.click(screen.getByRole("button", { name: "Add recurring transaction" }));
    const dialog = await screen.findByRole("dialog");

    const next = within(dialog).getByLabelText("Next date *");
    await user.clear(next);
    await user.type(next, "2026-12-01");
    expect(within(dialog).getByTestId("rt-preview")).toHaveTextContent("Next: Dec 1, 2026 · Jan 1, 2027 · Feb 1, 2027");

    const every = within(dialog).getByLabelText("Number of units between dates");
    await user.clear(every);
    await user.type(every, "3");
    expect(within(dialog).getByTestId("rt-preview")).toHaveTextContent("Next: Dec 1, 2026 · Mar 1, 2027 · Jun 1, 2027");

    // An interval cleared mid-edit makes no schedule, so the preview says nothing.
    await user.clear(every);
    expect(within(dialog).getByTestId("rt-preview").textContent).toBe("");
  });

  it("opens the edit dialog prefilled, with the active flag and id posted (AC17)", async () => {
    const user = userEvent.setup();
    renderCard([template({ relatedAccountId: 2, relatedAccountName: "Savings" })]);
    await user.click(screen.getByRole("button", { name: "Edit recurring transaction Rent" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit recurring transaction" });
    expect(within(dialog).getByLabelText("Description *")).toHaveValue("Rent");
    expect(within(dialog).getByLabelText("Account *")).toHaveValue("Checking");
    expect(within(dialog).getByLabelText("Related Account")).toHaveValue("Savings");
    expect(within(dialog).getByLabelText("Next date *")).toHaveValue("2026-12-01");
    expect(within(dialog).getByLabelText("Active")).toBeChecked();
    expect(hiddenFields(dialog)).toMatchObject({
      recurringTransactionId: "4",
      amount: "-1450.00",
      accountId: "1",
      relatedAccountId: "2",
      transactionTypeId: "2",
      transactionCategoryId: "3",
      cadence: "monthly",
      isActive: "true",
      // So a next date the hourly check moves on while the dialog is open
      // doesn't count as an edit that re-anchors the schedule (AC23).
      loadedNextRunDate: "2026-12-01",
    });
  });

  it("keeps a closed account on edit, marked closed, rather than posting it empty", async () => {
    const user = userEvent.setup();
    renderCard([template({ accountId: 99, accountName: "Old Visa", accountClosedDate: "2026-10-01", isActive: false })]);
    await user.click(screen.getByRole("button", { name: "Edit recurring transaction Rent" }));
    const dialog = await screen.findByRole("dialog");
    // A paused template may stay on its closed account, so a rename keeps it there.
    expect(within(dialog).getByLabelText("Account *")).toHaveValue("Old Visa (closed)");
    expect(hiddenFields(dialog).accountId).toBe("99");
  });

  it("keeps a closed related account on edit, so saving another field doesn't unlink it", async () => {
    const user = userEvent.setup();
    const updateAction = ok();
    renderCard([template({ relatedAccountId: 98, relatedAccountName: "Old Savings" })], { updateAction });
    await user.click(screen.getByRole("button", { name: "Edit recurring transaction Rent" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Related Account")).toHaveValue("Old Savings (closed)");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(1));
    expect(updateAction.mock.calls[0][1].get("relatedAccountId")).toBe("98");
  });

  it("previews a pause, and posts it", async () => {
    const user = userEvent.setup();
    const updateAction = ok();
    renderCard([template()], { updateAction });
    await user.click(screen.getByRole("button", { name: "Edit recurring transaction Rent" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByLabelText("Active"));
    expect(within(dialog).getByTestId("rt-preview")).toHaveTextContent("Paused: nothing is added");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(1));
    expect(updateAction.mock.calls[0][1].get("isActive")).toBe("false");
  });

  it("shows field errors returned by the action", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn<Action>(async () => ({
      success: false,
      errors: { nextRunDate: ["Next date can't be more than a year in the past."] },
      message: "Validation failed",
    }));
    renderCard([template()], { updateAction });
    await user.click(screen.getByRole("button", { name: "Edit recurring transaction Rent" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(await within(dialog).findByText("Next date can't be more than a year in the past.")).toBeInTheDocument();
  });

  it("closes on success", async () => {
    const user = userEvent.setup();
    const createAction = vi.fn<Action>(async () => ({ success: true, errors: {}, message: "Recurring transaction saved" }));
    renderCard([], { createAction });
    await user.click(screen.getByRole("button", { name: "Add recurring transaction" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(createAction).toHaveBeenCalledTimes(1);
  });

  it("confirms a delete, saying the transactions stay (AC25)", async () => {
    const user = userEvent.setup();
    const deleteAction = ok();
    renderCard([template()], { deleteAction });
    await user.click(screen.getByRole("button", { name: "Delete recurring transaction Rent" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Transactions it has already added are kept.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledTimes(1));
    expect(deleteAction.mock.calls[0][1].get("recurringTransactionId")).toBe("4");
  });
});
