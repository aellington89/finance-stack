import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { useIsMobile } from "@/hooks/use-mobile";

// The global setup stubs matchMedia with inert listeners, which is enough for
// components that merely mount. This hook *is* the listener, so each test
// installs its own stub and keeps the registered handler to fire by hand.
let handlers: Array<() => void>;
let removed: number;

const setWidth = (px: number) => {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: px,
  });
};

beforeEach(() => {
  handlers = [];
  removed = 0;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void) => handlers.push(cb),
      removeEventListener: () => {
        removed += 1;
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Renders the hook's value, so a server render and a hydration have markup to
// compare. renderHook alone cannot reach that half: it mounts on the client,
// where the hook reads the live width.
function Probe() {
  return <span>{useIsMobile() ? "mobile" : "desktop"}</span>;
}

describe("useIsMobile", () => {
  it("reports mobile below the 768px breakpoint", () => {
    setWidth(767);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });

  it("reports desktop at exactly the breakpoint", () => {
    // The comparison is `< 768`, so 768 itself is desktop. This is the edge
    // the media query and the width check have to agree on.
    setWidth(768);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("subscribes to the query built from the breakpoint", () => {
    setWidth(1024);
    renderHook(() => useIsMobile());
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
  });

  it("re-reads the width when the query changes", () => {
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    setWidth(500);
    act(() => {
      handlers.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });

  it("removes its listener on unmount", () => {
    setWidth(1024);
    renderHook(() => useIsMobile()).unmount();
    expect(removed).toBe(1);
  });

  // The server half of the contract (Issue #193). The server cannot know the
  // viewport, so its HTML always takes the desktop branch, and the first
  // client render has to agree with it. These two are also what hold hooks/**
  // at its coverage threshold: no client render ever calls the hook's server
  // snapshot.
  it("renders desktop on the server whatever the width", () => {
    setWidth(500);
    expect(renderToString(<Probe />)).toBe("<span>desktop</span>");
  });

  it("hydrates the server markup cleanly, then reports the real width", () => {
    setWidth(500);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<Probe />, { container, hydrate: true, onRecoverableError });

    // A mismatch surfaces through one of these two. Checked that it does: a
    // probe that reads the width during render on the client, but not on the
    // server, fails here.
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("mobile");
  });
});
