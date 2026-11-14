import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";

// Issue #428. axe's scrollable-region-focusable (serious, WCAG 2.1.1) fires
// when a scroll container has no focusable content: a keyboard user cannot
// scroll it. The shared Table wrapper owns the overflow-x-auto div, so the fix
// belongs there and every table inherits it. These tests pin both halves: an
// overflowing container becomes a named, tabbable region, while a table that
// fits adds no tab stop.

function renderTable() {
  return render(
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>Balance</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Table scroll container", () => {
  it("is a named, keyboard-reachable scroll region when it overflows", () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);

    renderTable();

    const region = screen.getByRole("region", { name: "Table" });
    expect(region).toHaveAttribute("data-slot", "table-container");
    expect(region).toHaveAttribute("tabindex", "0");
    // The wrapper must not replace or hide the table it scrolls.
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("adds no keyboard stop when the table fits", () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);

    renderTable();

    const container = document.querySelector('[data-slot="table-container"]');
    expect(container).not.toHaveAttribute("tabindex");
    expect(container).not.toHaveAttribute("role");
    expect(screen.queryByRole("region", { name: "Table" })).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
