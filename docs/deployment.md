# Deployment & Exposure

Where this stack may safely run, what has to be true before it is reachable from
the internet, and how the edge controls are verified. Added in
[Issue #182](https://github.com/aellington89/finance-stack/issues/182).

## Exposure posture

The stack supports two postures. Pick one deliberately — the difference is not
about how careful you are, it is about which controls are actually in place.

| | Trusted network | Public internet |
|---|---|---|
| Reached over | `http://<host>:3001` | `https://<your-hostname>` |
| Network | localhost, LAN, VPN, Tailscale | anywhere |
| Requires TLS | no | **yes** — see below |
| Traffic encrypted | **no** | yes |
| Default posture | ✅ | ❌ opt in |

**Trusted network is the default and needs no configuration.** It is also the
only posture in which running without TLS is defensible: over plain HTTP the
session cookie and every figure on every page cross the network in the clear, so
anyone who can see the traffic can read the data and replay the session.

Going public means all of the following are true, not just the first:

1. TLS terminates in front of the app (below).
2. Postgres and Metabase stay bound to loopback — they already are
   ([Issue #130](https://github.com/aellington89/finance-stack/issues/130), see
   [Database](database.md#roles--privileges)).
3. `AUTH_SECRET` is a real generated secret, not the `.env.example` placeholder
   ([Authentication](auth.md)).
4. The account password is strong. The sign-in limit below slows an online
   guessing attack; it does nothing about a weak password.

## TLS termination

The app does not terminate TLS and is not going to — it speaks plain HTTP on
`3001` and expects a reverse proxy in front. A `caddy` service ships for this,
switched off:

```bash
# 1. Set the hostname in .env — a DNS name that resolves to this host
PUBLIC_HOSTNAME=finance.example.com

# 2. Start the stack with the edge profile
docker compose --profile edge up -d

# 3. Verify
curl -sI https://finance.example.com
```

Caddy obtains and renews the certificate itself. That needs the hostname to
resolve to this host and ports 80 and 443 to be reachable, because the ACME
challenge is served over them. To try the proxy without a public name, add
`tls internal` inside the site block in [`caddy/Caddyfile`](../caddy/Caddyfile) to
issue from Caddy's own local CA instead — browsers will warn until that CA is
trusted on the client.

`PUBLIC_HOSTNAME` is the one required setting. If it is unset, Caddy has no site
address and refuses to start with `unrecognized global option: reverse_proxy`;
the failure is confined to that container and the rest of the stack comes up
normally. There is no ACME email variable — Caddy registers fine without one,
and an optional setting that breaks the config when omitted is worse than none.
To receive expiry notices, add a literal `email` to the Caddyfile as described in
its header comment.

Certificates live in the `caddy_data` volume. Losing it just means re-issuing on
next start.

Starting the `edge` profile does **not** change how you reach the app today:
`finance-app` keeps its own `3001` binding. On a genuinely internet-facing host,
rebind it to `127.0.0.1:3001:3001` in `docker-compose.yml` so the proxy is the
only public listener — the same pattern already applied to Postgres and Metabase
in #130. Auth.js runs with `trustHost: true`, so it takes the hostname from the
request; that is what lets it work behind any proxy name, and it is also why
untrusted traffic must not reach `3001` directly once the proxy is the front door.

### Using a different proxy

Nothing about the app is Caddy-specific. Any proxy works as long as it forwards
`X-Forwarded-Proto`, `X-Forwarded-For` and `X-Forwarded-Host`, and proxies to
`finance-app:3001` on the `appnet` network (or to the host's `3001`, if it runs
outside Compose). Security headers come from the app itself, so the proxy does
not need to add any.

## Security headers

Set in [`app/next.config.ts`](../app/next.config.ts) rather than in the proxy, so
they are present in every posture — including plain localhost — and do not depend
on a particular proxy being configured correctly.

| Header | Value | What it stops |
|---|---|---|
| `Content-Security-Policy` | see below | Loading or exfiltrating to another origin |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Downgrade to plaintext once TLS is in use |
| `X-Frame-Options` | `DENY` | Clickjacking (legacy clients) |
| `X-Content-Type-Options` | `nosniff` | MIME-sniffing a response into a script |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Leaking full URLs off-site |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Silent access to device APIs |
| `Cross-Origin-Opener-Policy` | `same-origin` | Cross-origin window references |

HSTS is sent unconditionally. Browsers ignore it over plaintext by specification,
so it costs nothing on a LAN and starts applying the day TLS is in front. It does
not offer `preload`: submission is effectively irreversible and the hostname
belongs to whoever deploys this.

The CSP keeps `'unsafe-inline'` on `script-src` and `style-src`, which is an
honest limitation rather than an oversight. Two things need it: `next-themes`
injects an inline script to set the theme before first paint, and
`components/ui/chart.tsx` injects a `<style>` element carrying each chart's
colour variables. Removing it means threading a per-request nonce through both,
tracked as a follow-up.

What the rest of the policy still buys, despite that: the app loads no
third-party scripts at all, so `default-src 'self'` and `connect-src 'self'`
mean injected script has nowhere to send data; `form-action 'self'` stops the
sign-in form being retargeted at someone else's server; `base-uri 'self'` stops
`<base>` rewriting every relative URL on the page; and `object-src 'none'`
removes the plugin surface.

### Verifying

```bash
curl -sI http://localhost:3001/ | grep -iE \
  'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin-opener'

# Also covered — these sit outside the proxy's matcher
curl -sI http://localhost:3001/login
curl -sI http://localhost:3001/api/health

# Should print nothing: poweredByHeader is off
curl -sI http://localhost:3001/ | grep -i x-powered-by
```

The header set is asserted in CI by `tests/unit/next-config-headers.test.ts`, and
again against a running container by the release smoke test in
`.github/workflows/release.yml`.

## Rate limits

| Surface | Budget | Keyed on | Counts |
|---|---|---|---|
| Sign-in | 5 per 15 minutes | username | failures only |
| Server actions | 120 per minute | signed-in user | every call |

The sign-in limit is enforced in
[`app/lib/auth/authorize-credentials.ts`](../app/lib/auth/authorize-credentials.ts),
which is the one path every credential attempt reaches — the login form posts to
`/login` as a server action rather than to `/api/auth/*`, but
`/api/auth/callback/credentials` is directly POST-able too, so limiting either
route alone would leave the other open. It is checked before the password is
verified, so a blocked attempt costs no scrypt work; that makes it a denial-of-service
control as well as a brute-force one. A successful sign-in clears the count.

The server-action limit lives in `requireActionUser()`, so every guarded action
is covered by construction, including ones added later. At 120/minute against
normal use in the low single digits, it will only be reached by a runaway client
or a stolen session.

Neither limit is configurable by environment variable. Both are constants in
[`app/lib/security/rate-limit.ts`](../app/lib/security/rate-limit.ts).

### Limitations, stated plainly

- **Counters are in process memory.** They reset when the container restarts and
  they are not shared across replicas. A lockout is a speed bump measured in
  minutes, not a durable ban. This is a deliberate trade — the stack has no Redis,
  and writing to Postgres on every login attempt would make the limiter its own
  amplification vector.
- **The sign-in limit is keyed on username, not IP.** The app cannot see a
  trustworthy client address: there is no proxy in the default posture, so
  `X-Forwarded-For` is absent or forged. The consequence is real — someone who
  knows the username can hold the legitimate user out for up to 15 minutes by
  failing five sign-ins. Restarting `finance-app` clears it immediately.
- **`/api/health` is deliberately not limited.** The Docker healthcheck polls it
  every 10 seconds and the release smoke test polls it in a loop.

### Observing them

Both limits log a `warn` record when they reject something, with no username or
other credential material in the line. See [Observability](observability.md).

```bash
docker compose logs finance-app | jq -c 'select(.scope=="login")'
docker compose logs finance-app | jq -c 'select(.scope=="action")'
```

## Out of scope

- **Nonce-based CSP.** Removing `'unsafe-inline'` needs a per-request nonce
  threaded through `proxy.ts`, the root layout, `next-themes`, and a refactor of
  `components/ui/chart.tsx` away from `dangerouslySetInnerHTML`.
- **IP-based rate limiting and durable lockouts.** Both become worth doing if the
  reverse proxy becomes the standard front door, since the proxy can supply a
  trustworthy client address.
- **WAF, fail2ban, intrusion detection.** No host-level controls are shipped or
  assumed.
- **Multi-replica deployment.** The rate limiter assumes a single app process.
