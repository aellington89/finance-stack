import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpandToggle } from "@/components/dashboard/expand-toggle";

// Mounted the way every table mounts it: inside a row that has its own
// onClick, because the interaction between the two is half of the contract.
function renderInRow(expanded: boolean) {
  const onToggle = vi.fn();
  const onRowClick = vi.fn();
  render(
    <table>
      <tbody>
        <tr onClick={onRowClick}>
          <td>
            <ExpandToggle expanded={expanded} onToggle={onToggle}>
              Current Asset
            </ExpandToggle>
          </td>
        </tr>
      </tbody>
    </table>
  );
  const toggle = screen.getByRole("button", { name: "Current Asset" });
  return { onToggle, onRowClick, toggle };
}

describe("ExpandToggle", () => {
  it("reports a collapsed row as collapsed, with a right-pointing chevron", () => {
    const { toggle } = renderInRow(false);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelector("svg.lucide-chevron-right")).toBeInTheDocument();
  });

  it("reports an expanded row as expanded, with a down-pointing chevron", () => {
    const { toggle } = renderInRow(true);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.querySelector("svg.lucide-chevron-down")).toBeInTheDocument();
  });

  it("is named by its label alone, with the chevron hidden from assistive tech", () => {
    const { toggle } = renderInRow(false);

    expect(toggle).toHaveAccessibleName("Current Asset");
    expect(toggle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("is reached by Tab and toggles on Enter and on Space", async () => {
    const user = userEvent.setup();
    const { onToggle, onRowClick, toggle } = renderInRow(false);

    await user.tab();
    expect(toggle).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("keeps a click from reaching the row, which would toggle it back", async () => {
    const user = userEvent.setup();
    const { onToggle, onRowClick, toggle } = renderInRow(false);

    await user.click(toggle);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
