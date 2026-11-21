import { log } from "@/lib/log";
import { reportError } from "@/lib/report";
import {
  RECURRING_SCHEDULE_ACTOR,
  runDueTemplates,
  type RunSummary,
} from "@/lib/recurring/materialize";

/**
 * The in-process timer that runs recurring transactions (Issue #135), started
 * once per server process from instrumentation.ts register().
 *
 * The app runs as a single long-lived `node server.js`, restarted by Compose,
 * so a timer in that process is the whole scheduler. There is no cron
 * container, no secret, and no URL anyone could call. The first run comes
 * shortly after boot, which is also how dates missed while the app was down
 * get caught up, and then one every hour. Hourly rather than daily means a day
 * turning over is picked up within the hour, whenever the process started.
 *
 * Nothing it does is silent:
 *
 *   - each template that fails is reported by runDueTemplates() (reportError,
 *     and so GlitchTip when ERROR_DSN is set) with its id;
 *   - a run that can't start at all is reported here;
 *   - a run with failures logs a warning with the counts, and every other run
 *     logs at info, even one with nothing to do: an hourly line at the default
 *     LOG_LEVEL is how to tell a quiet scheduler from a stopped one;
 *   - a tick that finds the previous run still going logs a warning and skips,
 *     rather than overlapping it. Lock waits inside a run are bounded
 *     (SCHEDULER_LOCK_TIMEOUT), so this means something is genuinely wrong.
 */

export const SCHEDULER_INITIAL_DELAY_MS = 30_000;
export const SCHEDULER_INTERVAL_MS = 60 * 60_000;

// A symbol on globalThis rather than a module variable: dev HMR can evaluate
// this module again, and a second copy must find the first one's timers.
const STARTED = Symbol.for("finance-stack.recurring-scheduler");

type Stop = () => void;

export interface SchedulerOptions {
  run?: () => Promise<RunSummary>;
  initialDelayMs?: number;
  intervalMs?: number;
}

/**
 * Starts the timers and returns a function that stops them. A second call
 * while running is a no-op that returns the same stop function.
 */
export function startRecurringScheduler(options: SchedulerOptions = {}): Stop {
  const registry = globalThis as unknown as Record<symbol, Stop | undefined>;
  const running = registry[STARTED];
  if (running) return running;

  const run = options.run ?? (() => runDueTemplates());
  const initialDelayMs = options.initialDelayMs ?? SCHEDULER_INITIAL_DELAY_MS;
  const intervalMs = options.intervalMs ?? SCHEDULER_INTERVAL_MS;

  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) {
      log.warn("recurring schedule run skipped: the previous run is still going", {
        job: RECURRING_SCHEDULE_ACTOR,
      });
      return;
    }
    inFlight = true;
    const startedAt = Date.now();
    try {
      const summary = await run();
      const fields = { job: RECURRING_SCHEDULE_ACTOR, ...summary, duration_ms: Date.now() - startedAt };
      if (summary.failed > 0) log.warn("recurring schedule ran with failures", fields);
      else log.info("recurring schedule ran", fields);
    } catch (error) {
      reportError(error, { job: RECURRING_SCHEDULE_ACTOR });
    } finally {
      inFlight = false;
    }
  };

  // unref(): the timers must never be what keeps a process alive. Next's own
  // server does that; a test or a script that imports this must still exit.
  const first = setTimeout(() => void tick(), initialDelayMs);
  first.unref?.();
  const every = setInterval(() => void tick(), intervalMs);
  every.unref?.();

  log.info("recurring scheduler started", {
    job: RECURRING_SCHEDULE_ACTOR,
    initial_delay_ms: initialDelayMs,
    interval_ms: intervalMs,
  });

  const stop: Stop = () => {
    clearTimeout(first);
    clearInterval(every);
    if (registry[STARTED] === stop) registry[STARTED] = undefined;
  };
  registry[STARTED] = stop;
  return stop;
}
