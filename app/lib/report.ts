import { captureEvent } from "@/lib/error-tracking";
import { log, type LogFields } from "@/lib/log";

/**
 * The single choke point for exceptional events (Issue #129).
 *
 * Two sinks, both fed the *same serialized value*: the structured logger, and
 * whatever error-tracking backend `ERROR_DSN` points at (Issue #232). Every
 * capture path in the app routes through here — instrumentation.ts,
 * lib/actions/failure.ts, the two client error boundaries, and the seed-data
 * health route — so this is the only place either sink needs wiring.
 *
 * **`serializeError()` runs once and both sinks receive its output.** That is the
 * load-bearing detail, not a tidiness one. The obvious shape —
 * `Sentry.captureException(error)` alongside the log call — hands the backend the
 * *raw* error, which still carries `DrizzleQueryError.params` (every bound value
 * of the failing statement) and pg's `detail`. It would ship the row the
 * redaction below exists to strip, and the redaction would be decorative. No
 * error-tracking code in this module or in lib/error-tracking.ts may take
 * `unknown`; both take the serialized form, so the leak is unreachable rather
 * than guarded against.
 *
 * No SDK ships, and lib/error-tracking.ts records why at length: the blocking
 * `npm audit` gates have no per-advisory allowlist, so an OpenTelemetry tree in
 * production dependencies is an unfixable CI failure mode waiting to happen.
 *
 * Kept separate from `log.ts` so the distinction survives: `log.info` is
 * routine, `reportError` is a failure someone may need to answer for. It is
 * isomorphic for the same reason `log.ts` is — the client error boundaries
 * import it.
 */

export interface ReportContext extends LogFields {
  /** Route path, e.g. "/dashboard/accounts" or "/api/health". */
  route?: string;
  /** Server-action name, e.g. "createAccount". */
  action?: string;
  /** users.user_id of the signed-in actor, where the call site can resolve it. */
  user_id?: string;
  /** React's error digest — correlates a browser record with the server one. */
  digest?: string;
}

/**
 * Fields copied off a `pg` DatabaseError. This is an **allowlist, not a
 * denylist**, which is the safety property that matters: a future pg release
 * adding a field cannot start leaking row data into the logs by default.
 *
 * Deliberately absent: `detail`, `hint`, `where`, `internalQuery`. `detail`
 * exists precisely to echo the offending values back ("Key
 * (account_name)=(Joint Checking) already exists"), and `where`/`internalQuery`
 * can carry literals out of a trigger body. What is kept identifies *which*
 * rule was violated without reproducing the row that violated it.
 *
 * The honest residual: `message` itself still embeds a value for some codes
 * ("invalid input syntax for type numeric: \"abc\""). Dropping `message` would
 * leave the log undiagnosable, so the line is drawn at the fields whose entire
 * purpose is to echo data. Documented in docs/observability.md.
 */
const DB_ERROR_FIELDS = ["code", "constraint", "table", "column", "schema"] as const;

/** Bound at a length that keeps one record readable in `docker logs`. */
const MAX_MESSAGE_CHARS = 1000;

/**
 * drizzle wraps every driver error in a `DrizzleQueryError` whose message is
 *
 *   Failed query: insert into "transactions" (…) values ($1, $2, …)
 *   params: 1284.55,Groceries at Whole Foods,2026-07-30,…
 *
 * — that is, **every bound value of the failing statement**. Left alone, a
 * single failed insert would put the whole row in the log, which is a bigger
 * leak than the pg `detail` field this module was originally written to guard.
 *
 * Cutting at the `params:` line keeps the parameterized SQL, which is the
 * genuinely useful half (placeholders, not values) and pairs with the SQLSTATE
 * on the wrapped cause.
 */
function redactMessage(message: string): string {
  const marker = message.indexOf("\nparams:");
  const withoutParams = marker === -1 ? message : message.slice(0, marker);

  return withoutParams.length > MAX_MESSAGE_CHARS
    ? `${withoutParams.slice(0, MAX_MESSAGE_CHARS)}… [truncated]`
    : withoutParams;
}

/**
 * `error.stack` opens with `${name}: ${message}`, so anything cut from the
 * message survives there unless the header is rewritten too. Missing this is
 * the easy way to "redact" a field and still ship it.
 */
function redactStack(
  stack: string | undefined,
  original: string,
  redacted: string
): string | undefined {
  if (!stack || redacted === original) return stack;
  return stack.split(original).join(redacted);
}

function serializeError(error: unknown, includeCause = true): LogFields {
  if (error instanceof Error) {
    const message = redactMessage(error.message);
    const serialized: LogFields = {
      name: error.name,
      message,
      stack: redactStack(error.stack, error.message, message),
    };

    // Errors have no enumerable own properties, so JSON.stringify(new Error())
    // is "{}" — everything above and below has to be copied across by hand.
    // Note what the allowlist excludes here: DrizzleQueryError also carries
    // `query` and `params` as own fields, and `params` is the same row data
    // redactMessage() just stripped out of the message.
    const source = error as unknown as Record<string, unknown>;
    for (const field of DB_ERROR_FIELDS) {
      if (source[field] !== undefined) serialized[field] = source[field];
    }

    // One level only. Drizzle can wrap a driver error, and the cause is where
    // the SQLSTATE lives when it does; recursing further just risks depth.
    if (includeCause && error.cause !== undefined && error.cause !== null) {
      serialized.cause = serializeError(error.cause, false);
    }

    return serialized;
  }

  // Not everything thrown is an Error: `throw "boom"`, a rejected promise
  // carrying a plain object, null. Never let that crash the error path.
  if (typeof error === "object" && error !== null) {
    const source = error as Record<string, unknown>;
    const serialized: LogFields = {
      name: typeof source.name === "string" ? source.name : "UnknownError",
      message: redactMessage(
        typeof source.message === "string" ? source.message : String(error)
      ),
    };
    for (const field of DB_ERROR_FIELDS) {
      if (source[field] !== undefined) serialized[field] = source[field];
    }
    return serialized;
  }

  return { name: "NonError", message: String(error) };
}

function describe(context: ReportContext): string {
  if (context.action) return `${context.action} failed`;
  if (context.route) return `Unhandled error in ${context.route}`;
  return "Unhandled error";
}

/**
 * React attaches an opaque `digest` hash to a server error and sends *only*
 * that to the browser, holding the real message back. It is therefore the one
 * value present on both sides, and the only way to join a browser record to the
 * server record that explains it.
 *
 * The client boundaries pass it explicitly (they receive it as a prop); on the
 * server it has to be lifted off the error here, because Next sets it as an own
 * property and `serializeError` copies through an allowlist. It is a hash of
 * nothing user-supplied, so it carries no data risk.
 */
function errorDigest(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    const digest = (error as Record<string, unknown>).digest;
    if (typeof digest === "string") return digest;
  }
  return undefined;
}

export function reportError(error: unknown, context: ReportContext = {}): void {
  // Serialized once, then shared. `error` itself goes no further than this line.
  const err = serializeError(error);
  const resolved: ReportContext = {
    ...context,
    digest: context.digest ?? errorDigest(error),
  };

  log.error(describe(resolved), { ...resolved, err });
  captureEvent(err, resolved);
}
