import { log, type LogFields } from "@/lib/log";
import type { ReportContext } from "@/lib/report";

/**
 * Sentry-protocol error capture (Issue #232).
 *
 * The second sink behind `reportError()`. Speaks the Sentry ingest protocol
 * directly over `fetch` — no SDK — against any backend that implements it:
 * GlitchTip (self-hosted, what this stack ships), Bugsink, or Sentry SaaS.
 *
 * **Why no SDK.** `@sentry/nextjs` pulls the OpenTelemetry package set into
 * production dependencies, and both `npm audit` gates in CI block on HIGH with
 * no per-advisory allowlist (CONTRIBUTING.md#ci-gates: "the gate goes red and
 * stays red"). The same tree becomes Trivy surface in two images. It would also
 * need a `register()` export instrumentation.ts does not have, `withSentryConfig`
 * around next.config.ts, and a `SENTRY_AUTH_TOKEN` build secret — which
 * docs/secrets.md's "no secret enters a build" rule is written against.
 *
 * **Why that is also the safer shape.** An SDK captures the *raw* error, so
 * redaction has to be re-implemented in a `beforeSend` hook that can drift from
 * `serializeError()`. This module never sees the raw error: `captureEvent` takes
 * the already-serialized, already-redacted `LogFields` that the logger receives,
 * so leaking a bound query parameter or a pg `detail` value is not something a
 * future edit here can reintroduce. Keep it that way — if this ever grows an
 * `error: unknown` parameter, that property is gone.
 *
 * **Server-only, by construction rather than by a check.** The DSN is read from
 * `ERROR_DSN`, which has no `NEXT_PUBLIC_` prefix, so Next does not inline it and
 * `process.env.ERROR_DSN` is simply `undefined` in a client bundle — the same
 * mechanism lib/log.ts documents for LOG_LEVEL. Both client error boundaries
 * therefore no-op here without a runtime branch, and CSP's `connect-src 'self'`
 * needs no exception. The ceiling that buys: a genuine browser-side throw stays
 * console-only. Server Component errors are unaffected — React redacts those to a
 * bare digest before they reach the browser anyway, and instrumentation.ts
 * captures the real one under the same digest (see docs/observability.md).
 *
 * Isomorphic for the same reason log.ts and report.ts are: no `@/auth`, no
 * `next/*`, no database. Note that rules out importing lib/version.ts for the
 * release stamp — it pulls package.json into the bundle (#171) — so the
 * NEXT_PUBLIC_ var it reads is read directly here.
 */

/** Protocol version in the auth header. 7 is current and has been for years. */
const SENTRY_VERSION = 7;

/** Bounds a send against an ingest host that accepts the connection and stalls. */
const SEND_TIMEOUT_MS = 2000;

/**
 * After this many consecutive failures the breaker opens. A backend that is down
 * must not turn every application error into an outbound request that also fails
 * — that is how an incident doubles. In-process counters, like the rate limiter:
 * one container, one process, and losing the count on restart is harmless here.
 */
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let breakerOpenUntil = 0;

interface ParsedDsn {
  /** Fully-qualified envelope endpoint. */
  endpoint: string;
  /** The DSN's public key, which goes in the auth header. */
  key: string;
}

/**
 * A DSN is `{protocol}://{public_key}@{host}[/{path}]/{project_id}`, and the
 * envelope endpoint is `{origin}{path}/api/{project_id}/envelope/`. The optional
 * path prefix is what makes this more than a split on "/": an instance served
 * under a subdirectory carries it, and dropping it posts into the void.
 *
 * Returns null rather than throwing on anything malformed. A typo in `.env` must
 * degrade to "no error tracking", never to "the error path throws".
 */
function parseDsn(raw: string | undefined): ParsedDsn | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!url.username || !projectId) return null;

  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return {
    endpoint: `${url.origin}${prefix}/api/${projectId}/envelope/`,
    key: url.username,
  };
}

/** Sentry wants a 32-character hex id, not a canonical dashed UUID. */
function eventId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Splits the serialized error into the two halves the event payload wants: the
 * `exception` interface gets name and message, everything else rides in `extra`.
 *
 * The stack goes to `extra` as a string rather than `exception.stacktrace.frames`.
 * Parsed frames would give clickable source lines, but they mean shipping a V8
 * stack parser and keeping it correct across Node releases; grouping works on
 * type + value regardless. Worth revisiting only if the stack strings prove hard
 * to read in practice.
 */
function buildException(err: LogFields): { type: string; value: string } {
  return {
    type: asString(err.name) ?? "Error",
    value: asString(err.message) ?? "",
  };
}

function buildExtra(err: LogFields): LogFields {
  const extra: LogFields = {};
  for (const [key, value] of Object.entries(err)) {
    // name and message are already carried by the exception interface above.
    if (key === "name" || key === "message") continue;
    if (value !== undefined) extra[key] = value;
  }
  return extra;
}

/**
 * The event payload. Every value here originates in `serializeError()`'s output
 * or in the call site's context — never in the raw error.
 */
function buildEvent(id: string, err: LogFields, context: ReportContext): unknown {
  const { route, action, digest, user_id: userId, ...rest } = context;

  return {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    logger: "finance-stack",
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_GIT_SHA || undefined,
    transaction: route,
    exception: { values: [buildException(err)] },
    // Tags are the indexed, searchable dimensions. Everything else the call site
    // passed (method, path, route_type, render_source …) stays queryable in extra.
    tags: { route, action, digest },
    user: userId ? { id: userId } : undefined,
    extra: { ...rest, ...buildExtra(err) },
  };
}

/**
 * Newline-delimited envelope: envelope header, then one item header and payload
 * per item. A trailing newline is permitted and omitted here.
 */
function buildEnvelope(id: string, event: unknown): string {
  const header = JSON.stringify({ event_id: id, sent_at: new Date().toISOString() });
  const payload = JSON.stringify(event);
  const itemHeader = JSON.stringify({ type: "event" });

  return `${header}\n${itemHeader}\n${payload}`;
}

function onSuccess(): void {
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    log.warn("Error-tracking backend reachable again", { scope: "error_tracking" });
  }
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}

/**
 * Deliberately quiet per failure and loud exactly once, on the transition. The
 * alternative — a line per dropped event — floods the log the operator is reading
 * to diagnose the original incident.
 *
 * `log.warn`, never `log.error`: reportError() is what called us, and routing a
 * capture failure back through it would recurse.
 */
function onFailure(reason: string): void {
  consecutiveFailures += 1;
  if (consecutiveFailures === BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    log.warn("Error-tracking backend unreachable; pausing capture", {
      scope: "error_tracking",
      reason,
      cooldown_seconds: BREAKER_COOLDOWN_MS / 1000,
    });
  } else if (consecutiveFailures > BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
  }
}

/**
 * Ships one already-redacted error to the configured backend. Fire-and-forget:
 * returns void synchronously so `reportError` can stay void and synchronous for
 * its call sites — two of which are inside a React `useEffect`.
 *
 * Nothing in here may throw. It runs on the error path, and an exception raised
 * over the top of the failure being reported replaces a handled error with an
 * unhandled one.
 */
export function captureEvent(err: LogFields, context: ReportContext = {}): void {
  const dsn = parseDsn(process.env.ERROR_DSN);
  if (!dsn) return;

  if (breakerOpenUntil > Date.now()) return;

  const id = eventId();
  let body: string;
  try {
    body = buildEnvelope(id, buildEvent(id, err, context));
  } catch {
    // The logger's own replacer handles cycles and BigInt; this one does not,
    // because the payload it is given has already been through that. If it
    // somehow still fails, drop the event — the log record already landed.
    return;
  }

  try {
    const response = fetch(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": [
          `Sentry sentry_version=${SENTRY_VERSION}`,
          `sentry_key=${dsn.key}`,
          `sentry_client=finance-stack/${process.env.NEXT_PUBLIC_GIT_SHA || "dev"}`,
        ].join(", "),
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    // Promise.resolve() rather than `response.then(...)` so a fetch stubbed to
    // return a non-promise in a test cannot throw here.
    void Promise.resolve(response).then(
      (res) => {
        // A 4xx is as much a failure as a refused connection — a wrong key or a
        // deleted project would otherwise look like success forever.
        if (res && typeof res === "object" && "ok" in res && !res.ok) {
          onFailure(`HTTP ${(res as Response).status}`);
        } else {
          onSuccess();
        }
      },
      (error: unknown) => {
        onFailure(error instanceof Error ? error.name : "unknown");
      }
    );
  } catch (error) {
    // fetch can throw synchronously on a malformed request rather than rejecting.
    onFailure(error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Test seam for the module-level breaker state, mirroring `__resetAllLimits` in
 * lib/security/rate-limit.ts. Not used by application code.
 */
export function __resetErrorTracking(): void {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}
