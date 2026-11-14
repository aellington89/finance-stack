import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityCard } from "@/components/settings/entity-card";

const action = () =>
  vi.fn(async () => ({ success: true, errors: {}, message: "" }));

const base = {
  title: "Transaction Categories",
  entityLabel: "category",
  idFieldName: "categoryId",
  updateAction: action(),
  deleteAction: action(),
};

const items = [
  { id: 1, name: "Groceries" },
  { id: 2, name: "Rent" },
];

describe("EntityCard", () => {
  it("lists every item", () => {
    render(<EntityCard {...base} items={items} createAction={action()} />);
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
  });

  it("shows an empty message derived from the title", () => {
    render(<EntityCard {...base} items={[]} createAction={action()} />);
    expect(
      screen.getByText("No transaction categories yet.")
    ).toBeInTheDocument();
  });

  // Issue #109: tables whose full row set ships with the app pass no
  // createAction, and must not offer an Add affordance at all.
  it("hides Add entirely when no create action is supplied", () => {
    render(<EntityCard {...base} items={items} />);
    expect(
      screen.queryByRole("button", { name: "Add category" })
    ).not.toBeInTheDocument();
  });

  it("offers Add when a create action is supplied", () => {
    render(<EntityCard {...base} items={items} createAction={action()} />);
    expect(
      screen.getByRole("button", { name: "Add category" })
    ).toBeInTheDocument();
  });

  // Issue #109: a protected row's edit/delete affordances are replaced by a
  // lock, because the server action would refuse them anyway.
  it("replaces edit and delete with a lock on a protected row", () => {
    render(
      <EntityCard
        {...base}
        createAction={action()}
        items={[{ id: 1, name: "Groceries", lockedReason: "Referenced by the importer" }]}
      />
    );

    expect(
      screen.getByLabelText("Groceries is protected")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Groceries" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete Groceries" })
    ).not.toBeInTheDocument();
  });

  // Issue #358: the lock was a span, so its tooltip, the only place the reason
  // appears, opened for a mouse alone. Reached the way a keyboard user reaches
  // it, with Tab, and read back the way a screen reader reads it on focus.
  it("lets the keyboard reach a protected row's lock and its reason", async () => {
    const user = userEvent.setup();
    render(
      <EntityCard
        {...base}
        items={[{ id: 1, name: "Groceries", lockedReason: "Referenced by the importer" }]}
      />
    );

    await user.tab();
    const lock = screen.getByRole("button", { name: "Groceries is protected" });
    expect(lock).toHaveFocus();
    expect(lock).toHaveAttribute("type", "button");
    expect(lock).toHaveAccessibleDescription("Referenced by the importer");
  });

  it("gives each protected row its own reason", () => {
    render(
      <EntityCard
        {...base}
        items={[
          { id: 1, name: "Groceries", lockedReason: "Referenced by the importer" },
          { id: 2, name: "Other", lockedReason: "The fallback category" },
        ]}
      />
    );

    expect(
      screen.getByRole("button", { name: "Other is protected" })
    ).toHaveAccessibleDescription("The fallback category");
  });

  it("offers edit and delete on an unprotected row", () => {
    render(<EntityCard {...base} items={items} createAction={action()} />);
    expect(screen.getByRole("button", { name: "Edit Groceries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Groceries" })).toBeInTheDocument();
  });

  // Issue #111: the reporting role is shown inline rather than hidden behind
  // the edit dialog, because it changes what the row does to the totals.
  it("shows a row's reporting role inline", () => {
    render(
      <EntityCard
        {...base}
        createAction={action()}
        items={[{ id: 1, name: "Mortgage", role: { key: "debt", label: "Debt" } }]}
      />
    );
    expect(screen.getByText("Debt")).toBeInTheDocument();
  });

  // Issue #358: the chip was muted text on a muted fill, 4.34:1 under axe. It
  // is an outline Badge now, foreground text on the card. jsdom cannot measure
  // contrast, so this pins the component that fixed it; axe in a real browser
  // is the authority on the ratio.
  it("renders the role as an outline badge", () => {
    const { container } = render(
      <EntityCard
        {...base}
        createAction={action()}
        items={[{ id: 1, name: "Mortgage", role: { key: "debt", label: "Debt" } }]}
      />
    );
    const chip = container.querySelector('[data-slot="badge"]');
    expect(chip).toHaveTextContent("Debt");
    expect(chip).toHaveClass("text-foreground");
    expect(chip).not.toHaveClass("text-muted-foreground");
    // The override has to win tailwind-merge, or both weights ship and the
    // stylesheet's order decides.
    expect(chip).toHaveClass("font-normal");
    expect(chip).not.toHaveClass("font-medium");
  });

  it("omits the role chip for a row that carries none", () => {
    const { container } = render(
      <EntityCard {...base} items={items} createAction={action()} />
    );
    expect(container.querySelectorAll('[data-slot="badge"]')).toHaveLength(0);
  });

  it("opens the edit dialog for the row whose pencil was clicked", async () => {
    const user = userEvent.setup();
    render(<EntityCard {...base} items={items} createAction={action()} />);

    await user.click(screen.getByRole("button", { name: "Edit Rent" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the delete dialog for the row whose bin was clicked", async () => {
    const user = userEvent.setup();
    render(<EntityCard {...base} items={items} createAction={action()} />);

    await user.click(screen.getByRole("button", { name: "Delete Rent" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // Issue #148: the delete dialogs share one Cancel, in front of the action.
  // Fresh action mocks here, because the ones in `base` are shared by every
  // test in the file.
  it("closes the delete dialog on Cancel without calling the delete action", async () => {
    const user = userEvent.setup();
    const deleteAction = action();
    render(
      <EntityCard
        {...base}
        deleteAction={deleteAction}
        items={items}
        createAction={action()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Delete Rent" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(deleteAction).not.toHaveBeenCalled();
  });

  // The edit dialog's Cancel sits inside its <form>. It has to be a plain
  // button, or clicking it would submit the edit it is meant to abandon.
  it("closes the edit dialog on Cancel without calling the update action", async () => {
    const user = userEvent.setup();
    const updateAction = action();
    render(
      <EntityCard
        {...base}
        updateAction={updateAction}
        items={items}
        createAction={action()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit Rent" }));
    const dialog = await screen.findByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("type", "button");
    await user.click(cancel);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(updateAction).not.toHaveBeenCalled();
  });
});
