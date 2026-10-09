# Deployment & Exposure

How a release is installed, upgraded, rolled back and restored on a server, and
what has to be true before that server is reachable from the internet. The
deployment half comes from the epic in
[Issue #223](https://github.com/aellington89/finance-stack/issues/223); the
exposure half from
[Issue #182](https://github.com/aellington89/finance-stack/issues/182).

## What the stack is made of

Every service that runs this repo's code runs it from an image
([Issue #224](https://github.com/aellington89/finance-stack/issues/224)) — none
of them reads code from the checkout any more:

| Image | Built from | Carries | Published as |
|---|---|---|---|
| `finance-app` | `app/Dockerfile` (`runner`) | the Next.js standalone server | `ghcr.io/aellington89/finance-app` |
| `finance-migrate` | `app/Dockerfile` (`migrate`) | drizzle-kit, `/roles` (database + role creation), `/seeds`, `/scripts/verify-db-roles.sh` | `ghcr.io/aellington89/finance-migrate` |
| `finance-importer` | `importer/Dockerfile` | `poll.py` and its pinned deps | `ghcr.io/aellington89/finance-importer` |
| `finance-backup` | `scripts/Dockerfile` | `backup.sh`, `restore.sh`, the balance-rebuild SQL | `ghcr.io/aellington89/finance-backup` |

Only data is bind-mounted: `./imports`, `./backups` and `./importer/parsers`.
`postgres` carries no mount but its data volume — its first-run `./init-db` hook
was folded into `migrate` by
[#225](https://github.com/aellington89/finance-stack/issues/225), so the stack
runs a stock `postgres:18.6` with nothing of this repo's in it.

**All four are published.** Every `vX.Y.Z` tag pushes them to GHCR at `:X.Y.Z`
and `:<full-sha>`, and only after the release workflow has booted the stack from
those exact images and verified it ([#226](https://github.com/aellington89/finance-stack/issues/226)) — so the artifact a host
pulls is the one CI proved. Details, including the tags and the one-time package
visibility step, are in
[Releases & Tagging](releases.md#published-images).

## The deployment bundle

A server does not get a checkout. It gets `finance-stack-X.Y.Z.tar.gz`, attached
to every GitHub Release
([#227](https://github.com/aellington89/finance-stack/issues/227)), which expands
to `/opt/finance-stack/` and **is** the deployment:

```
deploy.sh                install and upgrade
compose.yml              the stack, every image pinned to ${APP_VERSION}
.env.example             copy to .env, chmod 600, fill in
finance-stack.service    systemd unit
caddy/Caddyfile          reverse-proxy config (--profile edge)
README.md                install + upgrade runbook
imports/  importer/parsers/  backups/      data, bind-mounted
```

Requirements on the host are Docker Engine and the Compose plugin. Nothing else —
no source tree, no Node, no build toolchain.

**An upgrade installs the next bundle, not just the next images**
([#347](https://github.com/aellington89/finance-stack/issues/347)). Before #347,
`deploy.sh` only moved `APP_VERSION`, so every host kept the `compose.yml` of the
bundle it was first installed from. Third-party image updates, new services and
new settings never arrived, and the health gate — which checks the app's version
and nothing else — could not tell. Now `./deploy.sh X.Y.Z` fetches that release's
tarball, verifies it, and installs its files alongside the new images. A host's
own configuration stays its own: `.env`, `compose.override.yml` and the data
directories are never touched, and an edited `compose.yml` or `Caddyfile` is
handled as described in [Upgrading](#upgrading). `compose.yml`'s first line,
`# finance-stack bundle: X.Y.Z`, records which release it came from.

**The bundle carries its own copy of this runbook**, so the steps travel with the
release they describe and work on a host that cannot reach GitHub. This page is
the same procedure with links into the rest of these guides; the bundle's
`README.md` is the reference for what is deliberately not repeated here — the
`DEPLOY_*` override variables, the equivalent sequence done by hand, and the
troubleshooting one-liners.

`deploy/compose.yml` is a mirror of the repo's `docker-compose.yml` with exactly
two differences:

1. **Images are pulled, not built** — `${IMAGE_REGISTRY}/finance-<svc>:${APP_VERSION}`
   on the four published images, and no `build:` anywhere. One tag moves the whole
   stack, so a `finance-app` from one release can never run against a
   `finance-migrate` from another.
2. **`finance-app` binds `127.0.0.1:3001`**, not all interfaces — see below.

Everything else is identical, and that is enforced rather than hoped for. Two
compose files describing one stack drift, so:

- **`release.yml` boots `deploy/compose.yml`** for its `/api/health` verification,
  against locally-built images tagged with the exact references they are about to
  be published under. The file that ships is the file that gets smoke-tested, and
  an image that fails still reaches no registry.
- **`scripts/check-deploy-parity.sh` runs on every PR** (the `image` job in
  `ci.yml`). It renders both files with `docker compose config`, asserts and then
  strips the two permitted differences, and fails on anything else — a resource
  limit, healthcheck, `depends_on` condition or environment entry edited in one
  file and not the other. It compares the two `.env.example` variable sets too.

Editing either compose file therefore means editing both. Run the gate locally
with `./scripts/check-deploy-parity.sh`.

`docker compose up` from a checkout is unaffected and still builds from source.

### Why the deployed app binds loopback

The repo's `docker-compose.yml` publishes `3001` on all interfaces, because that
is how you reach the app from another machine on a trusted network. The bundle
does not, on the reasoning that a deployment host is *reachable* — so the app is
not exposed directly, and the only listener that can be is a proxy that
terminates TLS. It is the same [#130](https://github.com/aellington89/finance-stack/issues/130)
pattern already applied to `postgres` and `metabase`, extended to the app tier.

Two ways in, then: an SSH tunnel (`ssh -L 3001:127.0.0.1:3001 <host>`) for
occasional access, or the `edge` profile below for anything long-lived.

## First install

The bundle is the whole install. On a host with Docker Engine and the Compose
plugin:

```sh
# 1. Unpack, and put it where it lives
tar xzf finance-stack-X.Y.Z.tar.gz
sudo mv finance-stack-X.Y.Z /opt/finance-stack
cd /opt/finance-stack

# 2. Configure
cp .env.example .env
chmod 600 .env
"${EDITOR:-vi}" .env

# 3. Create the bind-mount directories, so Docker does not create them as root
mkdir -p imports importer/parsers backups

# 4. Install
./deploy.sh

# 5. Verify
curl -sS http://127.0.0.1:3001/api/health
docker compose ps
```

`./deploy.sh` with no argument uses the `APP_VERSION` already in `.env`, which
the bundle ships pre-filled to the release it was cut from. Step 4 pulls the
images, waits for Postgres, runs the one-shot `migrate` job — which creates the
databases, roles and seeds — then starts the app, importer and backup services,
and does not return success until `/api/health` reports that version.

**Every `changeme` in `.env` has to go.** `deploy.sh` refuses to run with a
placeholder still in place, and requires these eight to be set to something real:
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `AUTH_SECRET`,
`FINANCE_APP_DB_PASSWORD`, `FINANCE_IMPORTER_DB_PASSWORD`,
`FINANCE_BI_DB_PASSWORD`, `IMAGE_REGISTRY`. Generate the secret rather than
inventing one, since it signs every session cookie:

```sh
openssl rand -base64 33
```

Three things about that file are better known before you fill it in than after:

- **`MB_DB_PASS` is deliberately not required.** Empty is a meaningful value
  there — it tells the migrate job to skip provisioning Metabase's metadata role
  and database entirely
  ([#225](https://github.com/aellington89/finance-stack/issues/225)). A leftover
  `changeme` is still a misconfiguration and still aborts.
- **`POSTGRES_PASSWORD` is the one credential that does not rotate in place.** It
  is applied only when the Postgres data directory is first initialized, so
  editing it later changes nothing and locks out every maintenance job. Set it
  now; changing it afterwards means altering the role first, per
  [Rotating a role password](database.md#rotating-a-role-password).
- **The three `FINANCE_*_DB_PASSWORD` values go into URL-form connection
  strings**, so keep them URL-safe or percent-encode them — a literal `@ : / ? #`
  breaks the URL. The full credential inventory, how production sources them, and
  the rotation procedure are in [Secrets](secrets.md).

`.env` is mode `600` because it is the deployment's entire secret store, and
`deploy.sh` preserves that mode every time it re-pins a version.

### Creating the first user

There is no public registration, so a fresh install has no account to sign in
with until you make one. It runs in the `migrate` container, which is where every
other one-shot administrative command already lives:

```sh
docker compose run --rm --entrypoint npm migrate run auth:create-user -- <username>
```

The password is prompted for twice, hidden, with an eight-character minimum, and
re-running with an existing username resets it. A scripted install has no TTY to
prompt on, so pass the password in with `-e CREATE_USER_PASSWORD='…'` on that
same command — exporting it in your own shell does nothing, since
`docker compose run` does not forward the host environment.

This used to be the one step the bundle could not do. The CLI needs Node and the
application source, and neither published image had both — the `finance-app`
runner stage deletes npm ([#131](https://github.com/aellington89/finance-stack/issues/131)),
and `finance-migrate` carried `app/scripts/` but not `app/lib/`, so a bundle
install came up healthy and could not be logged into without a checkout on some
other machine. `finance-migrate` now carries `app/lib/` and `app/tsconfig.json`
(the latter is what makes the `@/…` imports resolve under `tsx`), which closes
the last hole in "a host needs Docker and nothing else"
([#288](https://github.com/aellington89/finance-stack/issues/288)). Details and
the password-reset path are in [Authentication](auth.md).

### systemd

```sh
sudo cp finance-stack.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now finance-stack
systemctl status finance-stack
```

`finance-stack.service` is `Type=oneshot` + `RemainAfterExit=yes` around
`docker compose up -d` / `down`, with `TimeoutStartSec=600` because a first
install runs every migration and seed inside `up -d`.

Surviving a reboot does **not** depend on it — that comes from
`restart: unless-stopped`, which the Docker daemon honours on its own. The unit
exists so that starting and stopping the stack is an ordinary system operation,
and so a deliberate `systemctl stop` stays stopped across a reboot. There is no
upgrade timer, and `deploy.sh` is the reason it stays that way rather than the
reason to add one: it distinguishes "rolled back cleanly" (exit 2) from "the
rollback also failed" (exit 3) precisely because the difference needs a person.
Nothing unattended can decide whether a `breaking` release additionally needs its
database restored.

## Upgrading

`deploy.sh` ships in the bundle and is the single entry point for both installing
and upgrading ([#228](https://github.com/aellington89/finance-stack/issues/228)):

```sh
cd /opt/finance-stack && ./deploy.sh X.Y.Z
```

It installs that release's bundle as well as its images. The files are
`compose.yml`, `.env.example`, `README.md`, `finance-stack.service`,
`caddy/Caddyfile` and, once the deploy has succeeded, `deploy.sh` itself
([#347](https://github.com/aellington89/finance-stack/issues/347)). It is
idempotent — re-running it at the already-deployed version converges the stack
and changes nothing else.

**A host on a `deploy.sh` that predates #347 needs one manual step, once.** You
can tell by the missing `DEPLOY_SCRIPT_VERSION=` line. That script cannot refresh
anything, itself included, so copy the new release's `deploy.sh` over it by hand
and run it as usual:

```sh
tar xzf finance-stack-X.Y.Z.tar.gz
cp finance-stack-X.Y.Z/deploy.sh /opt/finance-stack/deploy.sh
cd /opt/finance-stack && ./deploy.sh X.Y.Z
```

That run replaces the stale `compose.yml` and the rest, keeps the old copies in
`.bundle-backup/`, and prints a notice saying so. From then on the script keeps
itself current.

**Read the release's `**Migration:**` marker first.** It is the first line of the
release notes, on the GitHub Release and in [`CHANGELOG.md`](../CHANGELOG.md)
alike, and it answers in advance the question a failed upgrade would otherwise
ask you at the worst possible moment
([#277](https://github.com/aellington89/finance-stack/issues/277)):

| Marker | Rolling back across this release means |
|---|---|
| `none` | Re-pin the previous `APP_VERSION`. |
| `backward-compatible` | Re-pin the previous `APP_VERSION`. The old app runs against the new schema. |
| `breaking` | **Restore the pre-upgrade dump.** There are no down migrations. |

How a release picks its value is in
[Releases & Tagging](releases.md#release-procedure); the changelog gate fails a
release that carries no marker, so "the notes didn't say" is not a state you can
end up in.

### What it does, in order

1. **Preflight** — Docker, the Compose plugin, `curl`, `tar`, `sha256sum`, `.env`,
   and every required variable actually set to something other than `changeme`.
2. **Bundle** — the release's `finance-stack-X.Y.Z.tar.gz`, from `DEPLOY_BUNDLE`,
   the cache in `.bundles/` or the GitHub release. It is verified against its
   `.sha256`, unpacked into a scratch directory, and its `compose.yml` is checked
   against your Compose plugin. The script works out what installing it changes
   and reports what the release's `.env.example` adds. A missing or bad bundle,
   an edit that would be lost, or a new required setting stops the deploy here,
   with nothing changed.
3. **Pull** — from the release's `compose.yml`, so new third-party images come
   too. A nonexistent or bad version fails here, before anything running is
   touched and before `.env` is written.
4. **Backup gate** — a fresh `pg_dump` into `backups/`, taken *before* `migrate`
   runs. **If the dump fails, the deploy aborts.** Skipped on a first install
   (there is no database yet) and on a re-run of the deployed version that
   changes no files (no schema change is possible), and never skipped silently.
5. **Pin and install** — writes `APP_VERSION` into `.env`, preserving its mode,
   and installs the bundle's files, with every file it replaces copied aside
   first.
6. **Apply** — `docker compose up -d --remove-orphans`. Compose sequences it:
   postgres healthy → migrate exits 0 → app and importer start.
7. **Health gate** — polls `/api/health` for up to 180 seconds.
8. **On failure** — prints the `migrate` and `finance-app` logs, puts back the
   previous files and `APP_VERSION`, brings the previous version back up,
   re-polls, and tells you the dump path and the exact restore command.
9. **On success** — records the version in `.deployed-version`. It keeps the
   replaced files in `.bundle-backup/` and the bundle in `.bundles/`, updates
   `deploy.sh`, and prunes images and bundles older than the rollback target.
   It then re-applies any running `--profile bi`/`errors`/`edge` service on the
   new `compose.yml`.

Four of those are worth understanding rather than just running.

**The files move with the images, and edits are not silently dropped.** The
point of #347 is that `compose.yml` belongs to the release. But operators edit
things, and the docs ask for some edits — `tls internal` and an ACME `email` in
the Caddyfile. The script tells an edit from staleness by comparing the file
with the release it came from, then handles it as dpkg handles an edited
configuration file:

- An edited `compose.yml` that the release also changes **stops the upgrade**
  (exit 1), because replacing it would drop the edit. The message shows how to
  move the edit into `compose.override.yml`, which Compose merges in on its own
  and the script never touches.
- An edited `caddy/Caddyfile` is **kept**, since Caddy has no override file. The
  release's copy is written beside it as `caddy/Caddyfile.dist`.
- A file the release leaves alone keeps its edits either way.

The bundle's README has the details under "Customizing the stack".

**The dump is a gate, not a step.** It runs before `migrate` does, and a failed
dump aborts the deploy with nothing changed. `drizzle-kit` generates no down
migrations, so the moment a migration is applied, the only route back to the old
schema is a dump that already exists. Taking it afterwards would be taking it too
late; making it skippable would make it optional exactly when it matters.

**The health gate asserts one condition, not two in sequence.** It polls
`/api/health` until the response is 200 **and** `build.version` equals the
requested version. Splitting those — poll for 200, then check the version — is
correct on a fresh boot and wrong on an upgrade, because the old container is
still answering 200 with the old version while the new one starts.

**Rollback restores the application, not the database.** On a failed gate the
script puts back the previous files and `APP_VERSION`, brings the previous
version back and re-polls. Then it prints the pre-upgrade dump's path with the
exact `restore.sh` invocation, because where the release carried a schema change
the old app may not run against the schema now on disk.

The exit codes are meant to be branched on:

| Code | Meaning |
|---|---|
| `0` | Deployed and healthy. |
| `1` | Aborted before anything was applied — preflight, the bundle, the pull or the dump failed, or an edited `compose.yml` conflicts with the release. The running stack, `.env` and every file are untouched. |
| `2` | The upgrade failed and was **rolled back**; the previous version is healthy again, on its own files. |
| `3` | The upgrade failed **and the rollback failed**. Needs a human. |

`.github/workflows/deploy-smoke.yml` runs on every PR that touches the script.
It boots a packed bundle and exercises install, a same-version refresh, a failed
upgrade with its automatic rollback, malformed bundles and edit conflicts. The
"bad release" is the same image tagged under a version it does not report.

The bundle's own `README.md` is the reference for the parts deliberately not
repeated here. Those are the `DEPLOY_*` overrides — `DEPLOY_BUNDLE` for a host
that cannot reach GitHub, `DEPLOY_SKIP_BUNDLE` as the escape hatch, and the rest
— plus the equivalent sequence done by hand and the troubleshooting one-liners.
It ships beside `deploy.sh` in the release you are running, so it is always the
copy that matches.

### Rolling back

On a failed health gate there is nothing to run. The script has already put back
the previous files and `APP_VERSION`, brought the previous version back and
re-polled. Exit `2` means that worked and the previous version is healthy; exit
`3` means it did not.

To go back deliberately, name the older version:

```sh
./deploy.sh 0.4.0
```

That installs the older release's files as well. They come from `.bundles/` if
it is the version you just left, so it works without the network. The newer
`deploy.sh` stays in place, since it is the one that knows how to upgrade again.

Either way you have restored the *application*. If the release you are leaving was
marked `breaking`, the schema on disk is still the new one and the old app may not
run against it — carry on to the next section. For `none` and
`backward-compatible`, you are done.

### Restoring the database

`deploy.sh` prints the exact command on a rollback, with the real dump path
filled in. It looks like this:

```sh
docker compose exec pg-backup /scripts/restore.sh --force /backups/Finances_<timestamp>.dump Finances
```

If `pg-backup` is not running, use the one-shot form instead — `run` rather than
`exec`, because that service's entrypoint is a sleep loop:

```sh
docker compose run --rm -T --no-deps --entrypoint /scripts/restore.sh \
  pg-backup --force /backups/Finances_<timestamp>.dump Finances
```

`--force` is required because the target is **dropped and recreated** before the
dump is applied; `restore.sh` refuses to touch `Finances` or `metabase` without
it. It terminates existing connections to the target so the drop can proceed, so
`finance-app` will error until it reconnects — bring it down first
(`docker compose stop finance-app`) if you would rather not serve errors during
the restore. Full flag reference in [Backups](backups.md#restoring).

The whole sequence for a `breaking` rollback, then:

```sh
./deploy.sh 0.4.0                                    # 1. old app (auto-rollback has done this)
docker compose stop finance-app                      # 2. optional, avoids serving errors
docker compose exec pg-backup /scripts/restore.sh \
  --force /backups/Finances_<timestamp>.dump Finances # 3. old schema and data
./deploy.sh 0.4.0                                    # 4. re-converge and health-gate
```

Step 4 is not redundant. The restore recreated the database, and
[`02-grants.sql`](../init-db/roles/02-grants.sql) converges rather than assuming,
so re-running the deploy re-applies the roles and grants and then health-gates
the result instead of leaving you to check by eye. It is idempotent, so it costs
nothing if everything was already in place.

## Backups on a deployment

`pg-backup` starts with the stack and needs no configuration. It dumps every
database in `BACKUP_DBS` (default `Finances,metabase,glitchtip`) into `./backups/`
beside `compose.yml`, once at start and then every `BACKUP_INTERVAL_SECONDS`
(daily by default), pruning dumps older than `BACKUP_RETENTION_DAYS` (14) while
always keeping the newest of each database. Its healthcheck reports **unhealthy**
if no dump is newer than 1.5× the interval, which is the quick signal that the
loop has stalled. Configuration, formats and full disaster recovery are in
[Backups](backups.md).

**`BACKUP_DBS` is set in `.env`, so that value wins over the default.** The
template lists it explicitly, and a host set up before 1.1.0 copied
`Finances,metabase` from it — without `glitchtip`, which arrived with #232. That
is harmless while the `errors` profile is off, since a database that does not
exist is skipped. Turn GlitchTip on, though, and its database goes unbacked-up
until you add it. `deploy.sh` reports this kind of drift when a release changes a
default your `.env` still carries
([#347](https://github.com/aellington89/finance-stack/issues/347)). An upgrade
made before that report existed left no warning, so check by hand:
`grep ^BACKUP_DBS .env`.

Two things matter more on a deployment host than they do on a laptop:

- **The dumps sit on the same host as the database they protect.** A lost disk
  loses both. Copy them somewhere else — `scripts/backup.sh` exposes a
  `BACKUP_POST_HOOK` for exactly this, run after each dump.
- **Retention prunes pre-upgrade dumps like any other.** The gate's dumps land in
  the same directory in the same format, so the restore point for a `breaking`
  release disappears after `BACKUP_RETENTION_DAYS`. If you may want to roll back
  later than that, copy that dump aside — the script prints its path on success
  and on rollback.

Verify that a dump actually restores, rather than assuming it does, by restoring
into a throwaway database:

```sh
docker compose exec pg-backup /scripts/restore.sh --force Finances Finances_Restore_Check
```

## Metabase after a deploy

Metabase is behind the `bi` profile and does not start by default:

```sh
docker compose --profile bi up -d
```

Once it is running, upgrades keep it current. A plain `up -d` leaves a
profile-gated container on the definition it was started with, so `deploy.sh`
re-applies a running Metabase on each release's `compose.yml` after the app is
healthy ([#347](https://github.com/aellington89/finance-stack/issues/347)). Each
0.58.x bump then reaches the container rather than stopping at the file. The same
goes for GlitchTip and Caddy.

A fresh deploy starts it with an empty `metabase_data` volume and an empty
metadata database, so **it has no analytics connection at all** — not a
misconfigured one, none. Metabase stores those connections in its own metadata
database rather than in environment variables, so no `compose.yml` change can
create one and no `deploy.sh` run will notice it is missing. It is a manual step,
once, in the admin UI:

| Field | Value |
|---|---|
| Host | `postgres` |
| Port | `5432` |
| Database | `Finances` (or whatever `FINANCE_APP_DB` names) |
| Username | **`finance_bi`** |
| Password | `FINANCE_BI_DB_PASSWORD` from `.env` |

**Do not use `postgres` or `finance_app` here**, tempting though `finance_app` is
when a question fails on a missing table. Both can read `users.password_hash`,
and Metabase permits native SQL, so hiding the table in its admin UI is a display
setting rather than a privilege boundary. `finance_bi` exists precisely to have
`SELECT` on the core tables and views and **nothing on `users` or `audit_log`**
([#249](https://github.com/aellington89/finance-stack/issues/249)). The
step-by-step, and the query that tells you what the connection is *actually* set
to, are in
[Pointing Metabase at a least-privilege role](database.md#pointing-metabase-at-a-least-privilege-role).

Two things that look like this one and are not:

- **`MB_DB_USER` is a different role.** It owns Metabase's *internal* metadata
  database and has no access to `Finances`. It is not what you are editing here.
- **`finance_metabase` is gone.** A stricter views-only role of that name was
  retired in [#250](https://github.com/aellington89/finance-stack/issues/250)
  after it turned out that nothing had ever been pointed at it. If you find it
  named in older notes, the answer is `finance_bi`.

Restoring the `metabase` dump into a new deployment carries the stored connection
across, credential included — which also means it carries a *stale* credential
across if `FINANCE_BI_DB_PASSWORD` has been rotated since the dump was taken. Every
chart failing with `password authentication failed` right after a restore is that,
not a broken restore.

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
   ([Authentication](auth.md)), and so is every other credential in `.env`
   ([Secrets](secrets.md)). Nothing enforces this at boot — it is a checklist
   item precisely because the stack starts happily without it.
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

Edits to the Caddyfile survive upgrades
([#347](https://github.com/aellington89/finance-stack/issues/347)). `deploy.sh`
installs each release's files, but it keeps a Caddyfile you have changed. When
the release changes it too, the script writes the release's copy beside yours as
`caddy/Caddyfile.dist` and says so; merge what you need with
`diff caddy/Caddyfile caddy/Caddyfile.dist`.

Starting the `edge` profile does **not** change how you reach the app from a
checkout: the repo's `docker-compose.yml` keeps its own all-interfaces `3001`
binding, and on a genuinely internet-facing host you would rebind it to
`127.0.0.1:3001:3001` so the proxy is the only public listener. **A deployment
from the bundle already is bound that way** — `deploy/compose.yml` ships it, so
there is nothing to remember. Auth.js runs with `trustHost: true`, so it takes
the hostname from the request; that is what lets it work behind any proxy name,
and it is also why untrusted traffic must not reach `3001` directly once the
proxy is the front door.

### Using a different proxy

Nothing about the app is Caddy-specific. Any proxy works as long as it forwards
`X-Forwarded-Proto`, `X-Forwarded-For` and `X-Forwarded-Host`, and proxies to
`finance-app:3001` on the `appnet` network (or to the host's `3001`, if it runs
outside Compose). Security headers come from the app itself, so the proxy does
not need to add any.

## Security headers

Set by the app rather than by the reverse proxy, so they are present in every
posture — including plain localhost — and do not depend on a particular proxy
being configured correctly.

Everything except the CSP is compiled into the routes-manifest by
[`app/next.config.ts`](../app/next.config.ts). The CSP is emitted twice, because
it carries a per-request nonce that a build-time config cannot mint:

| Layer | Covers | CSP it sets |
|---|---|---|
| [`app/next.config.ts`](../app/next.config.ts) | every response | the nonce-free **floor** |
| [`app/proxy.ts`](../app/proxy.ts) | everything except `/_next/static`, `/_next/image`, `/favicon.ico` and `/api/health` | the same policy **plus a nonce**, overwriting the floor |

"Proxy" here means Next's own `proxy.ts` (the file formerly called
`middleware.ts`), not the reverse proxy in front of the app — that one still
needs to add nothing. Its header replaces the floor rather than joining it:
Next applies the routes-manifest headers first and `proxy.ts`'s second, into the
same map, so exactly one `Content-Security-Policy` header ships. That matters:
a browser enforces *every* policy it is sent, so two headers would intersect
into something nobody wrote.

The floor omits `'unsafe-inline'` from `script-src` even though nothing it
covers runs an inline script. That is deliberate, and makes the arrangement fail
closed: if the overwrite ever stopped happening, Next's own inline bootstrap
scripts would be blocked and the app would fail to hydrate visibly, rather than
quietly serving a weaker policy that still looks right in `curl -I`.

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

### The nonce, and why `style-src` is different

`script-src` carries no `'unsafe-inline'` ([#237](https://github.com/aellington89/finance-stack/issues/237)).
`proxy.ts` mints 128 bits of CSPRNG per request and puts it on both the response
header and the forwarded request header; Next reads the latter and stamps the
nonce onto its own bootstrap and flight-data scripts, and the root layout passes
it to `next-themes` for the script that sets the theme before first paint. This
is what makes the policy an XSS control rather than only an exfiltration
control — injected script can no longer execute at all.

Two consequences worth knowing before you debug something:

- **Every route is rendered per request.** Reading the nonce in the root layout
  opts the whole app into dynamic rendering, which is required rather than
  incidental: a prerendered page's inline scripts are baked in at build time
  with no nonce, so serving one under this policy means it never hydrates. Only
  `/` and the 404 page changed — the dashboard already rendered dynamically.
- **There is no nonce in development.** `next dev` serves the floor, with
  `'unsafe-inline'` and `'unsafe-eval'` for Turbopack. A nonce makes browsers
  ignore `'unsafe-inline'` entirely, which would break HMR and the error
  overlay. The nonce path is covered by `app/e2e/csp.spec.ts`, which runs
  against a production build.

`style-src` **does** keep `'unsafe-inline'`, and that is an upstream constraint
rather than unfinished work. Two things inject a `<style>` element with no nonce
and no way to accept one:

- `sonner` builds the whole of a toast's styling in JavaScript — 109 rules,
  `position: fixed` among them — and nothing else styles a toast. A nonce here
  turns every save and delete confirmation into unstyled text in the document
  flow.
- Next does the same in its own 404 fallback
  (`next/dist/client/components/http-access-fallback/error-fallback.js`).

Both must ship nonce support before this can change. `'unsafe-inline'` on
`style-src` also covers React's `style={{…}}` attributes, which
[`app/global-error.tsx`](../app/app/global-error.tsx) depends on entirely by
design — inline styles are the only styling a last-resort boundary can trust.
The residual risk is CSS-based exfiltration, which needs an injection point the
app does not have, and which `img-src 'self' data:` already constrains.

What the rest of the policy buys: the app loads no third-party scripts at all,
so `default-src 'self'` and `connect-src 'self'` mean injected script has
nowhere to send data; `form-action 'self'` stops the sign-in form being
retargeted at someone else's server; `base-uri 'self'` stops `<base>` rewriting
every relative URL on the page; and `object-src 'none'` removes the plugin
surface.

### Verifying

```bash
curl -sI http://localhost:3001/ | grep -iE \
  'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin-opener'

curl -sI http://localhost:3001/login

# The floor, not the nonce-bearing policy: both sit outside the proxy's matcher
# so the healthcheck never depends on Auth.js decoding a session.
curl -sI http://localhost:3001/api/health           # public liveness probe
curl -sI http://localhost:3001/api/health/seed-data # 401 without a session

# The nonce (#237). Must print a different value each time — a nonce that
# repeats is a guessable constant and no better than 'unsafe-inline'.
curl -sI http://localhost:3001/ | grep -io "nonce-[A-Za-z0-9+/=]*"
curl -sI http://localhost:3001/ | grep -io "nonce-[A-Za-z0-9+/=]*"

# Should print nothing: script-src no longer allows inline script
curl -sI http://localhost:3001/ | tr ';' '\n' | grep -i script-src | grep unsafe-inline

# Should print nothing: poweredByHeader is off
curl -sI http://localhost:3001/ | grep -i x-powered-by
```

Note that `style-src 'self' 'unsafe-inline'` is expected — see above. Grep for
`script-src` specifically rather than for `unsafe-inline` anywhere in the header.

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
  every 10 seconds and the release smoke test polls it in a loop. Since Issue #191
  it costs one `SELECT 1`, so it is not much of an amplifier; the seed-row check
  that used to ride along on it — three indexed lookups per request — moved to
  `/api/health/seed-data`, which requires a session, so an anonymous caller cannot
  drive those queries at all.

### Observing them

Both limits log a `warn` record when they reject something, with no username or
other credential material in the line. See [Observability](observability.md).

```bash
docker compose logs finance-app | jq -c 'select(.scope=="login")'
docker compose logs finance-app | jq -c 'select(.scope=="action")'
```

## Out of scope

- **`'unsafe-inline'` on `style-src`.** `script-src` is nonce-based as of
  [#237](https://github.com/aellington89/finance-stack/issues/237); `style-src`
  cannot follow until `sonner` and Next's own 404 fallback stop injecting
  nonce-less `<style>` elements. Blocked upstream, not deferred by choice — see
  [The nonce, and why `style-src` is different](#the-nonce-and-why-style-src-is-different).
- **IP-based rate limiting and durable lockouts.** Both become worth doing if the
  reverse proxy becomes the standard front door, since the proxy can supply a
  trustworthy client address.
- **WAF, fail2ban, intrusion detection.** No host-level controls are shipped or
  assumed.
- **Multi-replica deployment.** The rate limiter assumes a single app process.
