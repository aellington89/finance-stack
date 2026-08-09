# Secrets

Every credential this stack uses, where it comes from in production, and what
keeps it out of the repository and out of the images. Added in
[Issue #181](https://github.com/aellington89/finance-stack/issues/181).

## The inventory

Seven values. Nothing else in the stack is secret.

| Variable | Lives in | Consumed by | Generate with |
|---|---|---|---|
| `POSTGRES_PASSWORD` | root `.env` | `postgres` (at `initdb`), and `migrate` / `init-script` / `pg-backup` as `PGPASSWORD` | any generator; URL-safe |
| `MB_DB_PASS` | root `.env` | `init-db/01-create-databases.sh` (creates the role), `migrate` (syncs the role's password), `metabase` | any generator; URL-safe |
| `FINANCE_APP_DB_PASSWORD` | root `.env` | `migrate` (creates the role), `finance-app` inside `DATABASE_URL` | any generator; URL-safe |
| `FINANCE_IMPORTER_DB_PASSWORD` | root `.env` | `migrate`, `importer` inside `DATABASE_URL` | any generator; URL-safe |
| `FINANCE_BI_DB_PASSWORD` | root `.env` | `migrate` only — then entered by hand in the Metabase admin UI (#249) | any generator; URL-safe |
| `AUTH_SECRET` | root `.env` (Docker), `app/.env.local` (dev) | `finance-app` — signs and encrypts the session JWT | `openssl rand -base64 33` |
| `DATABASE_URL` | `app/.env.local` | local `npm run dev` and the test suites only | n/a — embeds a password |

`CREATE_USER_PASSWORD` is an eighth, but only ever transiently: it exists so
`npm run auth:create-user` can run non-interactively ([Authentication](auth.md)).
Set it for one command, do not put it in a file.

**Four of these go into URL-form connection strings**, so a literal `@ : / ? #`
in the value breaks the URL. Keep them URL-safe or percent-encode them.

The user's own sign-in password is not on this list — it lives scrypt-hashed in
the `users` table, and nothing outside Postgres ever holds it.

**What each of these is worth to an attacker is not obvious from the table**,
and `MB_DB_PASS` is the one that was most misread. It authenticates
`MB_DB_USER`, the role Metabase uses for its own metadata database. Read from
`init-db/01-create-databases.sh` that is a scoped login; on the live cluster it
was a **full superuser** with `CREATEDB`, `CREATEROLE`, `REPLICATION` and
`BYPASSRLS` — so the one variable the repository described as the narrowest of
the four database credentials was in fact the widest, equivalent to
`POSTGRES_PASSWORD`. That is fixed in
[#239](https://github.com/aellington89/finance-stack/issues/239): the role now
owns its metadata database and holds `CREATE` on that database's schema, has no
cluster attributes at all, and cannot connect to `Finances`. Its blast radius
is Metabase's own dashboards and questions — which still includes Metabase's
user table, so it is not nothing.

## Production secret sourcing

**One `.env` file on the deployment host. Never in an image, never in the repo.**

Compose reads `.env` on the host at `up` time and interpolates the values into
each service's environment. It is read where the stack runs, by the process that
starts it, and never enters a build. There is no secret-bearing layer to leak
if an image is published, and no build argument carrying a credential.

On the host:

```bash
cp .env.example .env
chmod 600 .env          # readable only by the user that runs `docker compose`
```

Three mechanisms keep it that way, and each is enforced rather than remembered:

| Mechanism | File | Enforced by |
|---|---|---|
| Not committable | `.gitignore` — `.env*` with `!.env.example` | `app/tests/unit/ignore-coverage.test.ts` |
| Not in the app build context | `app/.dockerignore` — `.env*`, no exception | the same test |
| Not committed anywhere, ever | full-history gitleaks scan | `.github/workflows/secret-scan.yml` |

`app/.dockerignore` is the one that matters for the shipped image, because
`docker-compose.yml` sets the `finance-app` build context to `./app`. It has no
negation on purpose, and the reason is worth stating exactly, because the
obvious reassurance is wrong.

Reading the Dockerfile, the runner stage looks safe: it copies `public`,
`.next/standalone`, `.next/static` and `CHANGELOG.md`, and not the source tree.
But **`next build` copies every `.env*` file it finds into
`.next/standalone`**, and the runner copies that directory wholesale. So a
`.env` sitting in the build context ends up in the finished image *verbatim*,
at `/app/.env`, readable by anyone who can run or pull the image.

This was measured, not reasoned about. Planting an `app/.env.production` and
building under the pre-#181 rules (`.env.local`, `.env*.local`) puts
`/app/.env.production` in the image with its contents intact; building the same
tree under `.env*` leaves no `.env` file anywhere under `/app`. Re-run it with
the recipe in the "Verifying" section below if you ever change these rules.

The rule the [deployment bundle](https://github.com/aellington89/finance-stack/issues/227)
inherits: the bundle ships `compose.yml` and a `.env.example`, and the operator
fills in `.env` on the host. It never ships a populated `.env`, and no image it
references is built with one.

### Verifying

The ignore rules themselves are asserted on every push by
`app/tests/unit/ignore-coverage.test.ts` (`npm run test:unit`). To check the
image end to end — worth doing after any change to `app/.dockerignore`, the
Dockerfile, or the Next.js major version, since the standalone copying
behaviour above is the part that could change under you:

```bash
# Plant a canary in the build context and build
printf 'CANARY=canary-check\n' > app/.env.production
docker compose build finance-app

# Expect: no output from either command
docker run --rm --entrypoint sh finance-app:latest -c 'find /app -name ".env*"'
docker run --rm --entrypoint sh finance-app:latest -c 'grep -rl canary-check /app 2>/dev/null'

rm app/.env.production
docker compose build finance-app     # rebuild clean
```

To see the check fail — always worth doing once, so you know it can — swap
`.env*` in `app/.dockerignore` back to `.env.local` and repeat: the first
command prints `/app/.env.production`.

### Why not Docker secrets

Considered and rejected, so it is not re-litigated.

`postgres` and `metabase` both support the `*_FILE` convention, so half the
stack could read credentials from `/run/secrets/` today. `finance-app` and
`importer` cannot: they consume a *composed* `DATABASE_URL`
(`postgresql://finance_app:${FINANCE_APP_DB_PASSWORD}@postgres:5432/…`), and
there is no `DATABASE_URL_FILE`. Adopting secrets therefore means adding an
entrypoint shim to both services that assembles the URL from a file at boot —
new code on the startup path of every service, to be maintained forever.

What that buys is keeping credentials out of `docker inspect` and out of each
container's environment. That is a real hardening step in a multi-tenant or
orchestrated deployment. It is worth much less here: this is a single-host,
single-operator stack whose secrets already sit in one `chmod 600` file on that
host, and an attacker positioned to run `docker inspect` has Docker socket
access — which is root-equivalent, and reads the file just as easily.

Revisit if the stack ever runs under Swarm or Kubernetes, where the secret
store is part of the platform rather than something to build.

## Rotation

The procedure is in [Database — Rotating a role password](database.md#rotating-a-role-password),
and is not repeated here. The one thing to know before you start:

- **Four of the five database passwords rotate from `.env` alone** — the three
  `FINANCE_*_DB_PASSWORD` values and `MB_DB_PASS`.
  `init-db/roles/01-create-roles.sql` and `init-db/roles/03-metabase-role.sql`
  re-issue an unconditional `ALTER ROLE … PASSWORD` on every `migrate` run.
- **`POSTGRES_PASSWORD` does not, and no future change will make it.** It is
  applied only when the Postgres data directory is first initialized, so editing
  it on an existing volume changes nothing. `migrate` cannot repair that the way
  it repairs the others, because it authenticates *as* that role and is locked
  out before any `ALTER` could run. Alter the role first, then update `.env`;
  get it backwards and `app/scripts/preflight-superuser.sh` says so and names the
  procedure ([#189](https://github.com/aellington89/finance-stack/issues/189)).
- **Rotating `AUTH_SECRET` signs everyone out.** There is no server-side session
  revocation, so this is also the only way to invalidate an outstanding session
  ([Authentication](auth.md)).

## What the audit found

The #181 audit covered the working tree and all 134 non-merge commits in the
history. Recorded here because "no committed secrets" is a claim that should
carry its evidence.

| Surface | Result |
|---|---|
| `.env.example`, `app/.env.local.example` | Every credential is `changeme` or `changeme-generate-with-openssl-rand-base64-33` — unusable by construction |
| `docker-compose.yml` | Every credential is `${VAR}`, with no `:-default` fallback anywhere |
| `init-db/`, `caddy/`, `importer/`, `scripts/` | No credential literals |
| `.github/workflows/` | CI-only values, named as such (`ci-app-pw`, `release-smoke-test-only-secret`) |
| Full git history | `.env` and `app/.env.local` were never tracked. No API keys, tokens, or private keys in any commit |

Three things it did find:

**One credential was far wider than the repository said.** `MB_DB_PASS` reads as
a scoped metadata-DB login everywhere it appears — the inventory above, the
`CREATE ROLE … WITH LOGIN PASSWORD` in `init-db/01-create-databases.sh`, and a
line in `docs/database.md` that stated outright it "was never the superuser."
The live role carried every attribute Postgres has. Nothing in the repository
recorded the change, and nothing would have caught it: the grant gate swept a
hand-maintained list of three role names, and `metabase_user` was not on it.
Broken out as [#239](https://github.com/aellington89/finance-stack/issues/239)
and fixed there — the role is de-privileged, the sweep now covers every login
role in the cluster, and CI asserts the gate fails when one is widened.

Two more:

**The ignore rules were narrower than they read.** The root `.gitignore` listed
`.env` and `app/.env.local` literally, so `.env.production`, `.env.local` and
`.env.bak` at the repository root were all stageable by a plain `git add .`.
`app/.dockerignore` had the matching gap. Both are now globs, and the test named
above is what stops them narrowing again.

**The initial commit hard-coded a password.** [`2208ce6`](https://github.com/aellington89/finance-stack/commit/2208ce6)
set `POSTGRES_PASSWORD: password` and `MB_DB_PASS: password` directly in
`docker-compose.yml`; `2d42bd2` replaced them with `${VAR}` references. The
literals remain readable in this public repository's history.

**The history was not rewritten, deliberately.** The exposed value is a
dictionary word — its presence in the log tells an attacker nothing they would
not have guessed. Rewriting history to remove it would invalidate every clone
and break the commit references in the changelog and in every issue, which is a
large, permanent cost for no reduction in risk.

Rotation is what closes an exposure like this, and it is an operator action on
a running stack rather than something a commit can do: follow
[Rotating a role password](database.md#rotating-a-role-password) for
`POSTGRES_PASSWORD` and `MB_DB_PASS`. Since #189 they take different routes —
`MB_DB_PASS` is an edit to `.env` plus a `migrate` run, `POSTGRES_PASSWORD` still
needs `\password` first — so do not assume one procedure covers both.
**Treat any deployment whose `.env` still carries
a value that appears in this repository's history as holding a public
credential.** More generally, if a real secret is ever committed the order is:
rotate first, treat the value as burned, and only then decide whether purging
the history is worth its cost.

## Limitations, stated plainly

- **`.env` is plaintext on the host.** Anyone with read access to that file, or
  root on that machine, has every credential. File permissions are the only
  control; there is no encryption at rest and no external secret store.
- **Secrets are visible in each container's environment** and in
  `docker inspect`. See the Docker-secrets discussion above — this is a known,
  accepted consequence of env-var delivery.
- **Nothing detects a placeholder at runtime.** A stack booted with the
  `.env.example` value of `AUTH_SECRET` signs its session cookies with a
  world-known key and starts perfectly happily. The go-public checklist in
  [Deployment & Exposure](deployment.md#exposure-posture) names this; no code
  enforces it yet.
- **The scan proves what was committed, not what was read.** gitleaks sees the
  repository. A credential pasted into an issue, a log, or a screenshot is
  outside everything described here.

## Out of scope

- **External secret stores** (Vault, SOPS, cloud secret managers) and
  encryption at rest for `.env`.
- **Docker secrets** — see above.
- **Automated rotation.** All rotation is manual and operator-initiated.
- **Per-user database credentials.** Every user of the app shares the one
  `finance_app` role; separation is by application-level auth, not by
  database identity.
