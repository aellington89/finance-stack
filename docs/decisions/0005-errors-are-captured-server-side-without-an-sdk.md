# 0005. Errors are captured server-side, through reportError(), without an SDK

Date: 2026-09-21 · Status: Accepted · Issue: #232

## Context

[Issue #129](https://github.com/aellington89/finance-stack/issues/129) made `reportError()` in
`app/lib/report.ts` the one place every capture path goes through, with structured logs as its only
sink. Docker rotates those logs away, and nothing alerted.
[Issue #232](https://github.com/aellington89/finance-stack/issues/232) chose a backend, and how to
send to it. The constraint: `serializeError()` strips bound query parameters and pg's `detail`, and
a default SDK call would send the raw error and the row with it. Recorded on 2026-11-23 from
[observability.md](../observability.md#error-tracking).

## Decision

- `reportError()` sends the already-serialized error to any backend that speaks the Sentry ingest
  protocol, through a small hand-written transport, when `ERROR_DSN` is set. No SDK ships.
- The DSN has no `NEXT_PUBLIC_` prefix, so capture is server-side only, and CSP's
  `connect-src 'self'` stays closed.
- The `errors` profile runs GlitchTip inside the stack, so error data stays on the server.

## Consequences

- The backend receives exactly what the logs receive, with the redaction applied: nothing in the
  capture path takes the raw error.
- No OpenTelemetry tree in production dependencies, the `npm audit` gates or the image scans, and
  no build-time `SENTRY_AUTH_TOKEN` ([secrets.md](../secrets.md)).
- Given up: breadcrumbs, source-mapped frames, automatic instrumentation and release health. Stack
  traces arrive as text.
- Alerting is still off by default: GlitchTip needs a mail relay before it can notify anyone
  ([Alerting is not configured by default](../observability.md#alerting-is-not-configured-by-default),
  #340). Until then, errors are collected but seen only by someone who looks.
- A genuine browser-side throw isn't captured; Server Component errors are, under the same digest.
  A same-origin ingest route would recover it (#339).

## Alternatives considered

- **Sentry SaaS with `@sentry/nextjs`.** Less work, but it sends data off the server, adds the
  dependency tree above, and needs a `beforeSend` copy of the redaction rules that can drift from
  the first.
- **A `NEXT_PUBLIC_ERROR_DSN`.** It would be inlined at `next build`, baking one operator's DSN
  into a published image, and the browser would post to another origin.
