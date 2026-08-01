/* eslint-disable no-console -- This is the one module allowed to call console. */

/**
 * Structured logging (Issue #129). Every record is a single line of JSON so
 * `docker compose logs finance-app | jq` works without a parser, and so a log
 * shipper can be pointed at the stack later without touching call sites.
 *
 * This module is deliberately **isomorphic**: no `@/auth`, no `next/*`, no
 * database. `app/(app)/error.tsx` and `app/global-error.tsx` are client
 * components and import it, so a server-only import here would break the
 * build — the same constraint that keeps `lib/actions/utils.ts` server-free
 * (see the header on `lib/auth/guard.ts`). Anything that needs a session
 * resolves it at the call site and passes `user_id` in.
 *
 * Field names are snake_case rather than the TypeScript camelCase used
 * elsewhere, to match `audit_log`'s columns — the two are most useful when
 * grepped together, and `user_id` meaning the same thing in both is worth more
 * than internal consistency here.
 *
 * See docs/observability.md.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LEVEL: LogLevel = "info";

// Keys the record owns; a caller cannot overwrite them through `fields`.
const RESERVED = new Set(["ts", "level", "msg"]);

/**
 * Resolved per call rather than at module load so the level can be changed
 * without a restart in tests. In a client bundle `process.env.LOG_LEVEL` is
 * simply undefined — Next only inlines `NEXT_PUBLIC_*` — which lands on the
 * default, and `error`/`warn` clear that threshold anyway.
 */
function threshold(): number {
  const configured = process.env.LOG_LEVEL;
  if (configured && configured in LEVEL_RANK) {
    return LEVEL_RANK[configured as LogLevel];
  }
  return LEVEL_RANK[DEFAULT_LEVEL];
}

/**
 * Replacer that survives what real log payloads contain: cycles (a pg error
 * chained to its own client), BigInt (which `JSON.stringify` throws on), and
 * Error values nested inside fields.
 *
 * Cycle detection walks the *ancestor* chain rather than a WeakSet of
 * everything seen, so an object referenced twice in different branches
 * serializes twice instead of being mislabelled `[Circular]`.
 */
function safeReplacer() {
  const ancestors: unknown[] = [];

  return function (this: unknown, _key: string, value: unknown): unknown {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return undefined;
    if (typeof value !== "object" || value === null) return value;

    // `this` is the object currently being serialized. Unwind back to it so
    // `ancestors` holds the path from the root to `value`, not everything
    // visited so far.
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(value)) return "[Circular]";
    ancestors.push(value);
    return value;
  };
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < threshold()) return;

  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      // `undefined` values are dropped by JSON.stringify, which is what makes
      // `{ user_id: session?.user?.id }` at a call site safe.
      if (!RESERVED.has(key)) record[key] = value;
    }
  }

  let line: string;
  try {
    line = JSON.stringify(record, safeReplacer());
  } catch (err) {
    // The logger is on the error path. If serialization fails — a throwing
    // toJSON(), a Proxy that traps ownKeys — losing the record is bad but
    // throwing over the top of the original failure is worse.
    line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      log_error: err instanceof Error ? err.message : String(err),
    });
  }

  // Warnings and errors go to stderr, the rest to stdout. Docker's json-file
  // driver captures both (see the x-logging anchor in docker-compose.yml).
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
