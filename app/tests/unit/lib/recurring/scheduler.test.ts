import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SCHEDULER_INITIAL_DELAY_MS,
  SCHEDULER_INTERVAL_MS,
  startRecurringScheduler,
} from "@/lib/recurring/scheduler";
import type { RunSummary } from "@/lib/recurring/materialize";

const summary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  today: "2026-11-14",
  due: 0,
  created: 0,
  paused: 0,
  failed: 0,
  ...overrides,
});

let stop: (() => void) | undefined;
let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

const records = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string) as Record<string, unknown>);

beforeEach(() => {
  vi.useFakeTimers();
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

// Mocks first: the unref case spies on the fake timer functions, so restoring
// after useRealTimers() would put the fakes back on globalThis.
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("startRecurringScheduler", () => {
  it("runs once after the initial delay, then every interval", async () => {
    const run = vi.fn(async () => summary());
    stop = startRecurringScheduler({ run, initialDelayMs: 1_000, intervalMs: 10_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("defaults to about 30s after boot, then hourly", () => {
    expect(SCHEDULER_INITIAL_DELAY_MS).toBe(30_000);
    expect(SCHEDULER_INTERVAL_MS).toBe(3_600_000);
  });

  it("says it started", () => {
    stop = startRecurringScheduler({ run: async () => summary() });
    expect(records(consoleLog)).toContainEqual(
      expect.objectContaining({ msg: "recurring scheduler started", interval_ms: 3_600_000 })
    );
  });

  it("is a no-op when already running, returning the same stop", async () => {
    const run = vi.fn(async () => summary());
    stop = startRecurringScheduler({ run, initialDelayMs: 1_000, intervalMs: 10_000 });
    const second = startRecurringScheduler({ run, initialDelayMs: 1_000, intervalMs: 10_000 });

    expect(second).toBe(stop);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("can be started again once stopped", async () => {
    const run = vi.fn(async () => summary());
    startRecurringScheduler({ run, initialDelayMs: 1_000 })();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).not.toHaveBeenCalled();

    stop = startRecurringScheduler({ run, initialDelayMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips a tick, with a warning, while the previous run is still going", async () => {
    let finish!: () => void;
    const run = vi.fn(
      () => new Promise<RunSummary>((resolve) => (finish = () => resolve(summary())))
    );
    stop = startRecurringScheduler({ run, initialDelayMs: 1_000, intervalMs: 10_000 });

    await vi.advanceTimersByTimeAsync(11_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(records(consoleWarn)).toContainEqual(
      expect.objectContaining({ msg: "recurring schedule run skipped: the previous run is still going" })
    );

    finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs a productive run at info, with its counts", async () => {
    stop = startRecurringScheduler({ run: async () => summary({ due: 2, created: 3 }), initialDelayMs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(records(consoleLog)).toContainEqual(
      expect.objectContaining({ level: "info", msg: "recurring schedule ran", due: 2, created: 3, job: "recurring-schedule" })
    );
  });

  it("logs a run with failures as a warning", async () => {
    stop = startRecurringScheduler({ run: async () => summary({ due: 2, failed: 1 }), initialDelayMs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(records(consoleWarn)).toContainEqual(
      expect.objectContaining({ level: "warn", msg: "recurring schedule ran with failures", failed: 1 })
    );
  });

  it("reports a run that throws, and keeps running", async () => {
    const run = vi
      .fn<() => Promise<RunSummary>>()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValue(summary());
    stop = startRecurringScheduler({ run, initialDelayMs: 1, intervalMs: 10_000 });

    await vi.advanceTimersByTimeAsync(1);
    expect(records(consoleError)).toContainEqual(
      expect.objectContaining({
        msg: "recurring-schedule failed",
        job: "recurring-schedule",
        err: expect.objectContaining({ message: "connection refused" }),
      })
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("unrefs its timers, so they never hold a process open", () => {
    const unref = vi.fn();
    vi.spyOn(globalThis, "setTimeout").mockReturnValue({ unref } as unknown as ReturnType<typeof setTimeout>);
    vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    stop = startRecurringScheduler({ run: async () => summary() });
    expect(unref).toHaveBeenCalledTimes(2);
  });
});
