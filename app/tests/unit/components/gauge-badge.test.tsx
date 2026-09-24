import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GaugeBadge } from "@/components/charts/gauge-badge";

// The only file under components/charts/ that is not a recharts wrapper: it is
// hand-rolled SVG, so unlike its neighbours it renders fully under jsdom and is
// held to the components/**/*.tsx threshold rather than excluded.
const segments = [
  { max: 30, color: "#red" },
  { max: 70, color: "#amber" },
  { max: 100, color: "#green" },
];

const paths = (c: HTMLElement) => Array.from(c.querySelectorAll("path"));
const strokes = (c: HTMLElement) =>
  paths(c).map((p) => p.getAttribute("stroke"));

describe("GaugeBadge", () => {
  it("renders its title and label", () => {
    render(
      <GaugeBadge title="Savings Rate" label="42%" value={42} max={100} segments={segments} />
    );
    expect(screen.getByText("Savings Rate")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("renders the SVG once mounted", () => {
    // The component renders nothing until its mount effect runs — a guard
    // against SSR/client float mismatch in the path coordinates.
    const { container } = render(
      <GaugeBadge title="t" label="l" value={50} max={100} segments={segments} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    // Track + one path per segment + pointer.
    expect(paths(container).length).toBeGreaterThanOrEqual(segments.length + 2);
  });

  it("draws one arc per segment, in the segment's colour", () => {
    const { container } = render(
      <GaugeBadge title="t" label="l" value={50} max={100} segments={segments} />
    );
    for (const seg of segments) {
      expect(strokes(container)).toContain(seg.color);
    }
  });

  it("omits a zero-width segment rather than drawing a degenerate arc", () => {
    const { container } = render(
      <GaugeBadge
        title="t"
        label="l"
        value={10}
        max={100}
        segments={[
          { max: 50, color: "#a" },
          { max: 50, color: "#degenerate" },
          { max: 100, color: "#b" },
        ]}
      />
    );
    expect(strokes(container)).not.toContain("#degenerate");
  });

  it("emits finite path coordinates for a value at either extreme", () => {
    for (const value of [0, 100]) {
      const { container, unmount } = render(
        <GaugeBadge title="t" label="l" value={value} max={100} segments={segments} />
      );
      for (const d of paths(container).map((p) => p.getAttribute("d") ?? "")) {
        expect(d).not.toMatch(/NaN|Infinity/);
      }
      unmount();
    }
  });

  it("clamps a value beyond the gauge rather than pointing off the dial", () => {
    const { container } = render(
      <GaugeBadge title="t" label="l" value={500} max={100} segments={segments} />
    );
    // valToAngle clamps to [min, max], so the pointer path must equal the one
    // drawn at exactly max.
    const over = paths(container).map((p) => p.getAttribute("d"));
    const { container: atMax } = render(
      <GaugeBadge title="t" label="l" value={100} max={100} segments={segments} />
    );
    expect(over).toEqual(paths(atMax).map((p) => p.getAttribute("d")));
  });

  it("renders with a single segment and no min", () => {
    const { container } = render(
      <GaugeBadge title="t" label="l" value={5} max={10} segments={[{ max: 10, color: "#solo" }]} />
    );
    expect(strokes(container)).toContain("#solo");
  });
});
