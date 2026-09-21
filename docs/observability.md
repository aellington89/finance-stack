# Observability

Every server-side failure emits **one line of JSON** carrying the level, the
route or action it came from, and the user it belongs to. Added in
[Issue #129](https://github.com/aellington89/finance-stack/issues/129).

```bash
docker compose logs finance-app | jq -c 'select(.level == "error")'
```

## Why several capture points rather than one

The obvious design is a single wrapper around server actions. That would miss
most of what goes wrong here, because the ways this app fails are caught in
different places:

| What fails | Captured by | Fields it can supply |
|---|---|---|
| A server action's database write | [`lib/actions/failure.ts`](../app/lib/actions/failure.ts) | `action`, `user_id` |
| Any unhandled server throw — page render, route handler, proxy, or an action throwing outside its `try` | [`instrumentation.ts`](../app/instrumentation.ts) | `route`, `route_type`, `method`, `path` |
| A client-side render error | [`(app)/error.tsx`](<../app/app/(app)/error.tsx>), [`global-error.tsx`](../app/app/global-error.tsx) | `route`, `digest` |
| The seed-reference drift check failing to run | [`api/health/seed-data/route.ts`](../app/app/api/health/seed-data/route.ts) | `route` |

All of them call `reportError()`, which is the only thing that matters when
adding a sink: there is one place to change, not five.

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

## Error tracking

`reportError()` has a second sink: any backend speaking the Sentry ingest
protocol, configured with a single optional variable.
Added in [Issue #232](https://github.com/aellington89/finance-stack/issues/232).

```bash
# .env — unset is a supported configuration and the default
ERROR_DSN=http://yourpublickey@glitchtip:8000/1
```

Unset, nothing changes: the structured logger stays the only sink, no outbound
request is ever made, and the stack starts and runs exactly as before.

### What is sent, and why it cannot leak

The transport is [`lib/error-tracking.ts`](../app/lib/error-tracking.ts), and the
property that matters is a type signature:

```ts
export function captureEvent(err: LogFields, context: ReportContext = {}): void
```

**It takes the serialized error, not the error.** `reportError()` runs
`serializeError()` once and hands the result to both sinks, so the backend
receives exactly what the log line receives — the redaction documented above,
already applied.

That is deliberate, and it is the whole reason no SDK ships. The natural shape,
`Sentry.captureException(error)` alongside the log call, hands the SDK the *raw*
error: `DrizzleQueryError.params` (every bound value of the failing statement)
and pg's `detail` included. It would ship the row this module exists to strip,
and every redaction rule above would be decorative. An SDK can be told to behave
with a `beforeSend` hook that re-applies the rules — but that is a second copy of
the rules, free to drift from the first. Here there is nothing to keep in sync,
because the raw error is never in scope.

If you change this, keep that property: **nothing in the capture path may take
`unknown`.**

### Why no SDK

Beyond the redaction argument, the cost is specific and local:

- `@sentry/nextjs` pulls the OpenTelemetry package set into *production*
  dependencies, and both `npm audit` gates block on HIGH with no per-advisory
  allowlist ([CI gates](../CONTRIBUTING.md#ci-gates)). A HIGH anywhere in that
  tree is a red gate with no escape hatch.
- The same tree becomes Trivy-scannable surface in two images.
- It needs a `register()` export `instrumentation.ts` does not have,
  `withSentryConfig` around `next.config.ts`, and a `SENTRY_AUTH_TOKEN` build
  secret — which [secrets](secrets.md) forbids by rule.

What the hand-rolled transport gives up: breadcrumbs, source-mapped frames,
automatic instrumentation, release health. Stack traces are sent as a string in
`extra.stack` rather than parsed frames, so they are readable but not clickable.
Grouping works on exception type and message regardless.

### Server-side only

The DSN has no `NEXT_PUBLIC_` prefix, so Next never inlines it and
`process.env.ERROR_DSN` is `undefined` in a client bundle — the same mechanism
`log.ts` relies on for `LOG_LEVEL`. Both client error boundaries therefore reach
`captureEvent()` and return without doing anything, with no runtime check, and
CSP's `connect-src 'self'` needs no exception.

**The ceiling that buys: a genuine browser-side throw is not captured.** It still
reaches the browser console via `reportError`, but no further. Server Component
errors are unaffected — React redacts those to a bare digest before they cross
the wire anyway, and `instrumentation.ts` captures the real one under the same
digest ([Reading a client error](#reading-a-client-error)).

Recovering browser errors means a same-origin ingest route, so the DSN stays
server-side and the CSP stays closed. That is not built — tracked in
[#339](https://github.com/aellington89/finance-stack/issues/339).

### Self-hosting the backend

`--profile errors` starts [GlitchTip](https://glitchtip.com/) inside this stack,
so error history never leaves the host. Off by default, like `bi` and `edge`.

```bash
docker compose --profile errors up -d
docker compose exec glitchtip ./manage.py createsuperuser   # the first user
```

Then open <http://127.0.0.1:8000>, create a project, and put the DSN it gives you
in `.env` as `ERROR_DSN` — using the container name, `glitchtip`, not localhost,
because finance-app resolves it over the Compose network.

**It is one container, not the three a Sentry-compatible stack usually implies.**
`SERVER_ROLE=all_in_one` runs the web process, the background worker and its own
Django migrations together, and `VALKEY_URL=""` puts the task queue, cache and
sessions on Postgres. That second setting is load-bearing beyond saving a
container: `lib/security/rate-limit.ts` and [deployment](deployment.md) both
state there is no Redis in this stack, and the in-process rate limiter is
justified partly on that. Adding one here would have quietly reopened it.

Its database rides the existing `postgres` service, owned by a role that holds
nothing else in the cluster — the Metabase pattern exactly
([`04-glitchtip-role.sql`](../init-db/roles/04-glitchtip-role.sql) mirrors
`03-metabase-role.sql`). `assert-grants.sql` enforces the separation rather than
trusting it: its sweep fails any undeclared login role that gains `CONNECT` on
`Finances`, and `scripts/verify-db-roles.sh` additionally connects as the role
and proves it is refused. Leaving `GLITCHTIP_DB_PASSWORD` empty skips
provisioning entirely, the same way an empty `MB_DB_PASS` skips Metabase.

It binds `127.0.0.1:8000` only. It holds every captured error message, so it has
no more business on the LAN than Metabase does, and self-signup is closed by
default — on a trusted network, open registration means anyone who can reach the
port can create an account.

The `glitchtip` database is in the default `BACKUP_DBS`, which is what actually
closes the gap that motivated this: before it, error history lived only in
Docker's `json-file` ring buffer, capped at 3 × 10 MB per service and in no
backup at all.

### Alerting is not configured by default

Tracked in [#340](https://github.com/aellington89/finance-stack/issues/340).

**Setting up the backend gives you durable, queryable, backed-up history. It
does not give you an alert.** GlitchTip notifies by email only — there is no
webhook, Slack or Discord option — and the shipped `EMAIL_URL` is
`consolemail://`, which writes notification mail to the glitchtip container's
log instead of sending it. An alert is therefore still a log line, just in a
different container.

Point `GLITCHTIP_EMAIL_URL` at a real relay to change that:

```bash
GLITCHTIP_EMAIL_URL=smtp://user:password@smtp.example.com:587
GLITCHTIP_FROM_EMAIL=glitchtip@example.com
```

That is opt-in rather than the default because it means a real SMTP credential
in `.env` and an outbound mail dependency on a stack the README says to keep on
a trusted network — a trade worth making deliberately rather than by default.

### When the backend is down

Delivery is fire-and-forget: `reportError()` stays synchronous and returns
`void`, and a send that fails can never throw over the top of the error being
reported. Sends are bounded by a 2-second timeout, and after five consecutive
failures a breaker opens for a minute — a backend that is down must not turn
every application error into an outbound request that also fails.

The breaker logs one `warn` when it opens and one when delivery recovers, never
one per dropped event. It is `log.warn` and not `log.error` for a structural
reason: `reportError()` is what called the transport, so reporting a capture
failure through it would recurse.

Counters are in process memory, like the rate limiter's. One container, one
process, and losing the count on restart costs nothing.

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

**Both files assert the same rules twice again — once against the log line, once
against the captured request body.** A sink that leaked the bound row while the
log stayed clean is exactly the regression #232 was written to prevent, so the
backend half is asserted on the wire, with `fetch` stubbed:

```ts
const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
const body = init.body as string;
expect(body).not.toContain(ACCOUNT_NAME);    // the bound parameter
expect(body).not.toContain("params:");
expect(body).not.toContain("Key (account_type_id)");   // pg detail
expect(body).toContain("$1");                // the diagnosis survives
```

`tests/unit/lib/error-tracking.test.ts` covers the transport itself — DSN
parsing, envelope framing, and the failure handling — and deliberately asserts
nothing about redaction, because `captureEvent()` has no ability to redact: it
never receives a raw error.

## Out of scope

No log shipper is configured — records go to stdout/stderr and Docker's
`json-file` driver, capped at 3 × 10 MB per service. Errors are the exception:
those have a durable home once `ERROR_DSN` is set, which is the gap that
motivated [#232](https://github.com/aellington89/finance-stack/issues/232). Pointing Loki, Vector or
Promtail at the stack is deliberately left for later; the JSON format is what
makes it a configuration change rather than a code change.

The Python [importer](importer.md) writes its own unstructured output and is not
covered here.
