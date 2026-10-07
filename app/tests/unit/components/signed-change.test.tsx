import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignedChange, TrendIcon } from "@/components/dashboard/signed-change";

// Issue #144's acceptance criterion is "icon + colour", so each case asserts
// both on the one element rather than the colour on its own.
describe("SignedChange", () => {
  it("pairs a gain's green with an upward trend icon", () => {
    render(<SignedChange value={5}>+$5.00</SignedChange>);

    const change = screen.getByText("+$5.00");
    expect(change).toHaveClass("text-green-600");
    expect(change.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
  });

  it("pairs a loss's red with a downward trend icon", () => {
    render(<SignedChange value={-5}>-$5.00</SignedChange>);

    const change = screen.getByText("-$5.00");
    expect(change).toHaveClass("text-red-600");
    expect(change.querySelector("svg.lucide-trending-down")).toBeInTheDocument();
  });

  it("gives a zero change neither a colour nor an icon", () => {
    render(<SignedChange value={0}>$0.00</SignedChange>);

    const change = screen.getByText("$0.00");
    expect(change.className).not.toMatch(/text-(green|red)-/);
    expect(change.querySelector("svg")).toBeNull();
  });

  it("gives an undefined percent change neither a colour nor an icon", () => {
    // formatPercentChange's em-dash: there is no direction to show.
    render(<SignedChange value={null}>—</SignedChange>);

    const change = screen.getByText("—");
    expect(change.className).not.toMatch(/text-(green|red)-/);
    expect(change.querySelector("svg")).toBeNull();
  });

  it("hides the icon from assistive tech, which reads the sign in the text", () => {
    render(<SignedChange value={5}>+$5.00</SignedChange>);

    expect(screen.getByText("+$5.00").querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });

  it("keeps the caller's classes alongside its own", () => {
    render(
      <SignedChange value={5} className="text-5xl font-bold">
        +$5.00
      </SignedChange>
    );

    expect(screen.getByText("+$5.00")).toHaveClass(
      "inline-flex",
      "text-green-600",
      "text-5xl",
      "font-bold"
    );
  });
});

// The icon alone, for the Period Change KPI, whose figure has no room for one
// on its own line.
describe("TrendIcon", () => {
  it("is an upward icon in green for a gain", () => {
    const { container } = render(<TrendIcon value={5} />);

    const icon = container.querySelector("svg.lucide-trending-up");
    expect(icon).toHaveClass("text-green-600");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("is a downward icon in red for a loss", () => {
    const { container } = render(<TrendIcon value={-5} />);

    expect(container.querySelector("svg.lucide-trending-down")).toHaveClass(
      "text-red-600"
    );
  });

  it("renders nothing when there is no direction to show", () => {
    const { container } = render(
      <>
        <TrendIcon value={0} />
        <TrendIcon value={null} />
      </>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("takes its size from the caller", () => {
    const { container } = render(<TrendIcon value={5} className="size-5" />);

    expect(container.querySelector("svg")).toHaveClass("size-5", "text-green-600");
  });
});
