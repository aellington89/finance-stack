# Observability

Every server-side failure emits **one line of JSON** carrying the level, the
route or action it came from, and the user it belongs to. Added in
[Issue #129](https://github.com/aellington89/finance-stack/issues/129).

```bash
docker compose logs finance-app | jq -c 'select(.level == "error")'
```

## Why three capture points rather than one

The obvious design is a single wrapper around server actions. That would miss
most of what goes wrong here, because the three ways this app fails are caught
in three different places:

| What fails | Captured by | Fields it can supply |
|---|---|---|
| A server action's database write | [`lib/actions/failure.ts`](../app/lib/actions/failure.ts) | `action`, `user_id` |
| Any unhandled server throw — page render, route handler, proxy, or an action throwing outside its `try` | [`instrumentation.ts`](../app/instrumentation.ts) | `route`, `route_type`, `method`, `path` |
| A client-side render error | [`(app)/error.tsx`](<../app/app/(app)/error.tsx>), [`global-error.tsx`](../app/app/global-error.tsx) | `route`, `digest` |

The first two are **not** redundant. Every action in `lib/actions/` catches its
own errors and returns an `ActionState` for the form to render — none of them
throw, so Next's `onRequestError` hook never sees them. That hook is what
catches the failures nobody anticipated: a bug in a query helper, a null deref,
a page that throws while rendering.

The third exists because of a property of the App Router that is easy to get
wrong: **in production, React redacts a Server Component error before it reaches
the browser.** `error.tsx` receives a generic message and a `digest`, never the
real one. So the client boundary is a correlation key, not a capture point —
see [Reading a client error](#reading-a-client-error) below.

`global-error.tsx` covers what `(app)/error.tsx` structurally cannot: a throw in
the root layout, which sits *above* that boundary. Before #129 those rendered
Next's built-in fallback and were recorded nowhere.

## The record

```json
{"ts":"2026-07-30T21:14:02.881Z","level":"error","msg":"createAccount failed","action":"createAccount","user_id":"c0ffee00-…","err":{"name":"Error","message":"Failed query: insert into \"accounts\" …","stack":"…","cause":{"name":"error","message":"insert or update on table \"accounts\" violates foreign key constraint \"accounts_account_type_id_fkey\"","code":"23503","constraint":"accounts_account_type_id_fkey","table":"accounts"}}}
```

| Field | Always? | Notes |
|---|---|---|
| `ts` | yes | ISO 8601, UTC |
| `level` | yes | `debug` \| `info` \| `warn` \| `error` |
| `msg` | yes | Derived from `action`, else `route`, else generic |
| `action` | action failures | The exported server-action name, e.g. `createAccount` |
| `route` | where known | `/dashboard/accounts`, `/api/health` |
| `route_type` | `instrumentation.ts` | `render` \| `route` \| `action` \| `proxy` |
| `user_id` | action failures | `users.user_id` — the same value `audit_log.actor_user_id` uses |
| `digest` | client boundaries | React's error digest; joins a browser record to a server one |
| `err` | error records | Serialized cause — see [Redaction](#redaction) |
| `scope` | rate-limit rejections | `login` \| `action` — which budget was spent ([#182](https://github.com/aellington89/finance-stack/issues/182)) |
| `entry_point` | `scope: "login"` | `authorize` (enforced) \| `action` (the login form's message peek) |

Field names are **snake_case**, matching `audit_log`'s columns rather than the
TypeScript camelCase used elsewhere. The two are most useful grepped together,
and `user_id` meaning the same thing in both is worth more than internal
consistency.

### Levels

Set `LOG_LEVEL` to `debug`, `info`, `warn` or `error`. Default and fallback for
an unrecognized value is `info`. `warn` and `error` go to stderr, the rest to
stdout; Docker's `json-file` driver captures both.

```yaml
# docker-compose.yml, finance-app service
LOG_LEVEL: ${LOG_LEVEL:-info}
```

## Redaction

**This is the part to understand before adding a log call.** The app's error
payloads carry financial data by default, from two directions.

### drizzle puts every bound parameter in the message

drizzle wraps every driver error in a `DrizzleQueryError` whose message is:

```
Failed query: insert into "transactions" ("transaction_description", "amount", …) values ($1, $2, …)
params: Groceries at Whole Foods,1284.55,2026-07-30,7
```

That is the entire row being written. `err.stack` opens with `${name}: ${message}`,
so it appears there too — redacting one and not the other ships it anyway.
[`lib/report.ts`](../app/lib/report.ts) cuts the message at the `params:` line
and rewrites the stack header to match. The parameterized SQL survives, which is
the useful half: placeholders, not values.

### pg's `detail` field exists to echo the offending value

`serializeError()` copies driver fields through an **allowlist, not a
denylist** — a future pg release adding a field cannot start leaking by default.

| Kept | Dropped |
|---|---|
| `name`, `message`, `stack` | `detail` — `Key (account_name)=(Joint Checking) already exists` |
| `code`, `constraint`, `table`, `column`, `schema` | `hint`, `where`, `internalQuery` — can carry literals out of a trigger body |
| | `query`, `params` — `DrizzleQueryError`'s own copy of the row |

What is kept identifies *which* rule was violated without reproducing the row
that violated it.

### Rate-limit records carry no credential material

The sign-in limiter ([#182](https://github.com/aellington89/finance-stack/issues/182))
logs `scope` and `entry_point` and nothing else — in particular **not** the
attempted username. The username field is exactly where a mistyped password
lands, so recording it would put a credential in the log on precisely the
attempts worth logging. The cost is that these lines cannot be grouped by
account; the count and the timing are what matter.

### The residual risk, stated honestly

`message` can still embed a value for some SQLSTATEs — `invalid input syntax for
type numeric: "abc"` is the common one. Dropping `message` would leave the log
undiagnosable, so the line is drawn at the fields whose *entire purpose* is to
echo data. **These logs are not sanitized to the point of being safe to paste in
public.** Treat `docker compose logs finance-app` with the same care as the
database itself.

`instrumentation.ts` deliberately logs only `path` and `method`, never
`request.headers` — those carry the Auth.js session cookie, and an allowlist of
"safe" headers is a thing to get wrong later.

Messages are truncated at 1000 characters so one bad record cannot flood the
10 MB log file.

## Using it

Application code must not call `console.*` — ESLint enforces this over `app/`,
`lib/`, `components/` and `hooks/` (`scripts/` is exempt; console output *is* a
CLI's interface). Use one of:

```ts
import { log } from "@/lib/log";
log.info("Backfill complete", { route: "/api/health", rows: 42 });

import { reportError } from "@/lib/report";
reportError(err, { route: "/api/health" });        // anything exceptional

import { actionFailure } from "@/lib/actions/failure";
} catch (error) {                                   // inside a server action
  return actionFailure("createAccount", error, "Failed to create account. Please try again.");
}
```

`actionFailure` resolves `user_id` itself and returns the `ActionState` the form
renders, so a catch block is one call.

`log.ts` and `report.ts` are **isomorphic** — no `@/auth`, no `next/*`, no
database imports — because the client error boundaries import them. Keep it that
way; anything needing a session resolves it at the call site and passes
`user_id` in, the same constraint that keeps
[`lib/actions/utils.ts`](../app/lib/actions/utils.ts) server-free.

### Reading a client error

A browser record and its server counterpart share a `digest`:

```jsonc
// browser console
{"level":"error","msg":"Unhandled error in /dashboard/accounts","route":"/dashboard/accounts","digest":"3552847923","err":{"message":"An error occurred in the Server Components render…"}}
```

```bash
docker compose logs finance-app | jq -c 'select(.digest == "3552847923" or (.err.digest? == "3552847923"))'
```

The server record is the one with the real error. Next also prints the digest
alongside its own stack trace, so grepping the raw log for the digest works too.

The digest is lifted off the error in `reportError()` rather than being passed
in by `instrumentation.ts`: React sets it as an own property, and
`serializeError()` copies through an allowlist that deliberately excludes
unknown fields.

> **Gotcha when working on this.** `instrumentation.ts` is loaded once at server
> start and is **not** hot-reloaded, so an edit to `log.ts` or `report.ts` will
> not show up in `onRequestError` output until you restart `npm run dev`. A
> change that looks like it did nothing is usually this.

## Common queries

```bash
# Every error, newest last
docker compose logs finance-app | jq -c 'select(.level == "error")'

# Which actions are failing, and how often
docker compose logs finance-app | jq -r 'select(.action) | .action' | sort | uniq -c | sort -rn

# One user's failures
docker compose logs finance-app | jq -c 'select(.user_id == "c0ffee00-…")'

# Group by SQLSTATE
docker compose logs finance-app | jq -r '.err.cause.code // .err.code // empty' | sort | uniq -c

# Sign-ins refused by the rate limiter — a run of these is someone guessing
docker compose logs finance-app | jq -c 'select(.scope == "login")'

# Server actions refused by the rate limiter, by user
docker compose logs finance-app | jq -r 'select(.scope == "action") | .user_id' | sort | uniq -c

# Anything that is not valid JSON — i.e. not from lib/log.ts
docker compose logs --no-log-prefix finance-app | grep -v '^{'
```

That last one is worth running after adding a dependency: Next itself, `pg`, and
the Node runtime all write unstructured lines, and this separates ours from
theirs.

## Wiring an error-tracking backend

Tracked by [Issue #232](https://github.com/aellington89/finance-stack/issues/232).

**No SDK ships today, on purpose.** `@sentry/nextjs` pulls the OpenTelemetry
package set into the *blocking* `npm audit --omit=dev` gate and the Trivy image
scan ([CI gates](../CONTRIBUTING.md#ci-gates)), needs `withSentryConfig` wrapped
around `next.config.ts`, and wants a `SENTRY_AUTH_TOKEN` build secret — all to
ship pg error text off a stack the [README](../README.md#security) says to keep
on a trusted network.

The seam is built for it anyway. `reportError()` in
[`lib/report.ts`](../app/lib/report.ts) is the single choke point every capture
point already routes through, so adding a backend is one call in one file:

```ts
export function reportError(error: unknown, context: ReportContext = {}): void {
  log.error(describe(context), { ...context, err: serializeError(error) });
  Sentry.captureException(error, { extra: context });   // <- the whole change
}
```

Two things to decide first:

- **Where it goes.** [GlitchTip](https://glitchtip.com/) speaks the Sentry DSN
  protocol and self-hosts on Postgres + Redis, which keeps the data inside the
  stack. Sentry SaaS is less work and more egress.
- **What it sends.** The SDK captures the *raw* error, not the redacted copy
  above — `DrizzleQueryError.message` and pg `detail` included. Route it through
  `serializeError()` first, or set a `beforeSend` hook that applies the same
  rules, or the redaction here is decorative.

## Testing log output

Assert on the emitted string, not on a mock of the logger — the acceptance
criterion is about what an operator's `jq` receives:

```ts
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
// ...
const line = consoleError.mock.calls[0][0] as string;
expect(line).not.toContain("\n");            // one record, one line
expect(JSON.parse(line).action).toBe("createAccount");
```

Redaction gets tested twice on purpose: `tests/unit/lib/report.test.ts` models
the error shapes, and `tests/integration/actions/logging.test.ts` forces a real
foreign-key violation through `createAccount` so the model cannot drift away
from what the driver actually throws. If you change `serializeError()`, the
integration test is the one that tells you the truth.

## Out of scope

No log shipper is configured — records go to stdout/stderr and Docker's
`json-file` driver, capped at 3 × 10 MB per service. Pointing Loki, Vector or
Promtail at the stack is deliberately left for later; the JSON format is what
makes it a configuration change rather than a code change.

The Python [importer](importer.md) writes its own unstructured output and is not
covered here.
