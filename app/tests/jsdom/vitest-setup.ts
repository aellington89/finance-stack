import { vi, afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Testing Library normally registers its own cleanup through the global
// `afterEach`, but only when `globals: true` — and this suite deliberately
// imports describe/it/expect from "vitest" instead. Without this line the
// previous test's tree stays mounted and the *second* render of a component in
// any one file starts failing with "found multiple elements", which reads as a
// bad selector rather than as a missing teardown. It is the first thing to
// check when a test passes alone and fails in a file.
afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and both are reached on mount rather than
// on interaction: matchMedia by hooks/use-mobile.ts (and everything that goes
// through useSidebar), ResizeObserver by the @base-ui/react primitives.
// Without them a render throws before a single assertion runs.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList,
});

class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// The same shape as tests/integration/vitest-setup.ts: mock the Next.js
// runtime the suite replaces rather than exercises. Defaults are the
// dashboard's own route, and a test that drives a route-dependent branch
// overrides per call with vi.mocked(usePathname).mockReturnValue(...).
vi.mock("next/navigation", () => {
  // One router object for the whole file, not a fresh one per call. A
  // component that calls useRouter() during render and a test that calls it to
  // assert must get the *same* mock, or the assertion inspects a throwaway.
  // Reset per test by the beforeEach below.
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  };
  return {
    redirect: vi.fn(),
    useRouter: vi.fn(() => router),
    usePathname: vi.fn(() => "/dashboard"),
    useSearchParams: vi.fn(() => new URLSearchParams()),
  };
});

// Every next/navigation export is a vi.fn(), so a test can steer any of them
// with vi.mocked(usePathname).mockReturnValue(...) and assert on
// useRouter().replace. Clearing here keeps one test's navigation out of the
// next one's assertions.
beforeEach(async () => {
  const nav = await import("next/navigation");
  vi.mocked(nav.usePathname).mockReturnValue("/dashboard");
  vi.mocked(nav.useSearchParams).mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof nav.useSearchParams>
  );
  const router = nav.useRouter();
  for (const fn of Object.values(router)) vi.mocked(fn).mockClear();
});
