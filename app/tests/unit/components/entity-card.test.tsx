import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("omits the role chip for a row that carries none", () => {
    const { container } = render(
      <EntityCard {...base} items={items} createAction={action()} />
    );
    expect(container.querySelectorAll(".bg-muted.px-1\\.5")).toHaveLength(0);
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
});
