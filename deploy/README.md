# Finance Stack — deployment bundle

This directory is the **entire deployment**. There is no source tree, no Node,
and no build toolchain on the server: every service runs from a published image
pinned to one release, and only data is stored beside this file.

Packed as `finance-stack-X.Y.Z.tar.gz` and attached to every
[GitHub Release](https://github.com/aellington89/finance-stack/releases)
([Issue #227](https://github.com/aellington89/finance-stack/issues/227)).

This file is canonical for the override variables, the manual equivalent
sequence, and the troubleshooting commands below, and it is the copy that matches
the release you are holding. The repository's
[docs/deployment.md](https://github.com/aellington89/finance-stack/blob/master/docs/deployment.md)
carries the same install and upgrade procedure with links into the full guides —
backups, database roles, secrets, auth — and tracks `master`.

```
/opt/finance-stack/
  deploy.sh                install and upgrade — the one command you run
  compose.yml              the stack, images pinned to ${APP_VERSION}
  .env.example             copy to .env and fill in
  finance-stack.service    systemd unit
  caddy/Caddyfile          reverse-proxy config (--profile edge)
  README.md                this file
  imports/                 drop folder — one subdirectory per import type
  importer/parsers/        your parsers (user-specific, not shipped)
  backups/                 pg_dump output

  compose.override.yml     your own changes to the stack, if you make any
  .deployed-version        written by deploy.sh: what is deployed
  .bundles/                written by deploy.sh: this release's bundle and the previous one
  .bundle-backup/          written by deploy.sh: the files the last upgrade replaced
```

The first line of `compose.yml` names the release it came from
(`# finance-stack bundle: X.Y.Z`).

## Requirements

Docker Engine with the Compose plugin. That is the whole list.

```sh
docker --version
docker compose version
```

`deploy.sh` additionally uses `curl` for its health gate and to download a
release's bundle, and `tar` and `sha256sum` to verify and unpack it — all present
on essentially every server distribution. It uses `jq` if you have it and falls
back to a text extraction if you do not, so it is not a prerequisite.

## Install

```sh
# 1. Unpack
tar xzf finance-stack-X.Y.Z.tar.gz
sudo mv finance-stack-X.Y.Z /opt/finance-stack
cd /opt/finance-stack

# 2. Configure. Every `changeme` in .env.example must be replaced; APP_VERSION
#    is already set to the release this bundle was cut from.
cp .env.example .env
chmod 600 .env
"${EDITOR:-vi}" .env

# 3. Create the data directories. These are bind mounts, so Docker would
#    otherwise create them itself, owned by root.
mkdir -p imports importer/parsers backups

# 4. Install. This pulls the images, waits for Postgres, runs the one-shot
#    migrate job (which creates the databases, roles and seeds), starts the app,
#    importer and backup services, and does not return success until
#    /api/health reports the version you asked for.
./deploy.sh

# 5. Verify
curl -sS http://127.0.0.1:3001/api/health
docker compose ps
```

`./deploy.sh` with no argument uses the `APP_VERSION` already in `.env`, which the
bundle ships pre-filled. `docker compose up -d` still works and does the same
thing; what it does not do is health-gate the result or take a backup first,
which is why upgrades go through the script.

Generate a real `AUTH_SECRET` rather than editing the placeholder by hand:

```sh
openssl rand -base64 33
```

### Create the first user

There is no public registration, so the first account is created by hand. It runs
in the `migrate` container — the same one-shot administrative image that applies
the migrations and hosts `verify-db-roles.sh`
([#288](https://github.com/aellington89/finance-stack/issues/288)):

```sh
docker compose run --rm --entrypoint npm migrate run auth:create-user -- <username> [--role admin|user]
```

The password is prompted for twice, hidden, with an eight-character minimum. For
a scripted install there is no TTY to prompt on, so pass the password into the
container with `-e` — exporting it in your own shell does nothing, because
`docker compose run` does not forward the host environment:

```sh
docker compose run --rm -e CREATE_USER_PASSWORD='…' \
  --entrypoint npm migrate run auth:create-user -- <username>
```

It connects as `postgres`, not `finance_app` — the `users` table is deliberately
read-only to the application role (#130), so an app-level compromise cannot mint
an account. You do not supply that credential: `compose.yml` builds the
connection string from the `POSTGRES_USER` and `POSTGRES_PASSWORD` already in
your `.env`, so the superuser password never reaches your shell history.

**Re-running with an existing username resets that user's password**, which is
also how you recover from losing it. `--role` defaults to `admin` and is written
on the reset path too, so omitting it on a re-run puts that account back to
`admin`; the command echoes the role it wrote.

See [Authentication](https://github.com/aellington89/finance-stack/blob/master/docs/auth.md).

### Run under systemd

```sh
sudo cp finance-stack.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now finance-stack
systemctl status finance-stack
```

The unit is what makes `systemctl start|stop finance-stack` work. Surviving a
reboot does not depend on it — that comes from `restart: unless-stopped` in
`compose.yml`, which the Docker daemon honours on its own.

## Reaching the app

`finance-app` binds **`127.0.0.1:3001`**, not all interfaces. A fresh install is
reachable from the host and refused from the network, which is the safe default:
over plain HTTP the session cookie and every figure on every page cross the
network in the clear.

Two supported ways to reach it from elsewhere:

**An SSH tunnel**, which needs no configuration:

```sh
ssh -L 3001:127.0.0.1:3001 <host>      # then open http://localhost:3001
```

**TLS termination**, for anything long-lived. Set `PUBLIC_HOSTNAME` in `.env` to
a DNS name that resolves to this host, then:

```sh
docker compose --profile edge up -d
curl -sI https://<your-hostname>
```

Caddy obtains and renews the certificate itself, which needs ports 80 and 443
reachable. `postgres` (5433) and `metabase` (3000) are loopback-bound too and
stay that way. See
[Deployment & Exposure](https://github.com/aellington89/finance-stack/blob/master/docs/deployment.md).

## Upgrading

```sh
cd /opt/finance-stack
./deploy.sh X.Y.Z
```

That is the whole procedure. The script fetches that release's bundle — this
tarball, for the new version — checks it against its `.sha256`, and installs its
`compose.yml`, `.env.example`, `README.md`, `finance-stack.service` and
`caddy/Caddyfile` at the moment it pins `APP_VERSION`
([#347](https://github.com/aellington89/finance-stack/issues/347)). New services,
updated third-party images and new settings therefore arrive with the release's
images rather than lagging behind them. It never touches `.env` beyond
`APP_VERSION`, `compose.override.yml`, `imports/`, `importer/parsers/` or
`backups/`. The script is idempotent — re-running it with the version already
deployed converges the stack and changes nothing else.

**Coming from an older `deploy.sh`? One manual step, once.** A `deploy.sh` with
no `DEPLOY_SCRIPT_VERSION=` line predates #347: it re-pinned `APP_VERSION` and
nothing else, so it never refreshed the files above — itself included. Give the
host the new script by hand, then run it as usual:

```sh
tar xzf finance-stack-X.Y.Z.tar.gz
cp finance-stack-X.Y.Z/deploy.sh /opt/finance-stack/deploy.sh
cd /opt/finance-stack && ./deploy.sh X.Y.Z
```

It replaces the stale files itself, keeps the old copies in `.bundle-backup/`, and
says so. If you had edited `compose.yml`, move those edits into
`compose.override.yml` afterwards — see
[Customizing the stack](#customizing-the-stack). From then on `deploy.sh` keeps
itself current.

**Read the release's `**Migration:**` marker first.** It is the first line of the
release notes and says whether rolling back needs a dump restore:

| Marker | Rolling back means |
|---|---|
| `none` | Re-pin the previous `APP_VERSION`. |
| `backward-compatible` | Re-pin the previous `APP_VERSION`. The old app runs against the new schema. |
| `breaking` | **Restore the pre-upgrade dump.** There are no down migrations. |

### What it does, in order

1. **Preflight** — Docker, the Compose plugin, `curl`, `tar`, `sha256sum`, `.env`,
   and every required variable actually set to something other than `changeme`.
2. **Bundle** — gets the release's `finance-stack-X.Y.Z.tar.gz` from
   `DEPLOY_BUNDLE`, the cache in `.bundles/` or the GitHub release, verifies it
   against its `.sha256`, unpacks it into a scratch directory and checks its
   `compose.yml` against your Compose plugin. It then works out what installing
   it changes, and prints what the release's `.env.example` adds or changes. It
   **stops** if an edited `compose.yml` would be lost (see
   [Customizing the stack](#customizing-the-stack)) or if the release needs a new
   setting your `.env` lacks. A missing or bad bundle fails here too, before
   anything has changed.
3. **Pull** — from the release's `compose.yml`, so a new third-party image is
   pulled too. A nonexistent or bad version fails here, before anything running
   is touched and before `.env` is written.
4. **Backup gate** — a fresh `pg_dump` into `backups/`, taken *before* `migrate`
   runs. **If the dump fails, the deploy aborts.** Skipped on a first install
   (there is no database yet) and on a re-run of the deployed version that
   changes no files (no schema change is possible).
5. **Pin and install** — writes `APP_VERSION` into `.env`, preserving its mode,
   and installs the bundle's files, copying aside every file it replaces.
6. **Apply** — `docker compose up -d --remove-orphans`. Compose sequences it:
   postgres healthy → migrate exits 0 → app and importer start. A service the
   release no longer defines is removed.
7. **Health gate** — polls `/api/health` until it returns 200 **and**
   `build.version` equals the version you asked for, for up to 180 seconds. Both
   conditions in one loop, because during an upgrade the old container answers
   200 with the old version.
8. **On failure** — prints the `migrate` and `finance-app` logs, puts back the
   previous files and `APP_VERSION`, brings the previous version back up,
   re-polls, and tells you the dump path and the exact restore command.
9. **On success** — records the version in `.deployed-version`, keeps the files
   it replaced in `.bundle-backup/` and the bundle in `.bundles/`, replaces
   `deploy.sh` with the release's (never with an older one), and removes image
   tags and bundles older than the rollback target. Any optional service you
   have running — `--profile bi`, `errors` or `edge` — is re-applied on the new
   `compose.yml`, which a plain `up -d` would not do.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Deployed and healthy. |
| `1` | Aborted before anything was applied — preflight, the bundle, the pull or the dump failed, or an edited `compose.yml` conflicts with the release. The running stack, `.env` and every file here are untouched. |
| `2` | The upgrade failed and was **rolled back**; the previous version is healthy again, on its own files. |
| `3` | The upgrade failed **and the rollback failed**. Needs a human. |

### Rolling back

Automatic, on any failed health gate — there is nothing to run, and the files
the upgrade installed are put back along with `APP_VERSION`. To go back
deliberately, name the older version:

```sh
./deploy.sh 0.4.0
```

That installs the older release's files too — from `.bundles/` if it is the
version you just left, so it works offline — but keeps the newer `deploy.sh`,
which is the one that knows how to upgrade again.

**A rollback restores the application, not the database.** If the release you are
leaving was marked `breaking`, the old app may not run against the schema now on
disk, and you also need the dump the upgrade took. The script prints the exact
command; it looks like this:

```sh
docker compose exec pg-backup /scripts/restore.sh --force /backups/Finances_<timestamp>.dump Finances
```

(If `pg-backup` is not running, use
`docker compose run --rm -T --no-deps --entrypoint /scripts/restore.sh pg-backup --force /backups/<file>.dump Finances`.)

### Overrides

Environment variables, not `.env` keys — they configure the script, not the stack.

| Variable | Default | Use |
|---|---|---|
| `DEPLOY_SKIP_PULL=1` | off | Deploy images already on the host (an offline or air-gapped upgrade). |
| `DEPLOY_HEALTH_TIMEOUT` | `180` | Seconds to wait for the health gate. |
| `DEPLOY_HEALTH_URL` | `http://127.0.0.1:3001/api/health` | If you moved the app's port (in `compose.override.yml` — see below). |
| `DEPLOY_BUNDLE` | unset | Path to the release's `finance-stack-X.Y.Z.tar.gz`, for a host that cannot reach GitHub. Its `.sha256` must be beside it. |
| `DEPLOY_RELEASE_URL` | `https://github.com/aellington89/finance-stack/releases/download` | Where bundles are downloaded from, for a fork or a mirror. |
| `DEPLOY_SKIP_BUNDLE=1` | off | Deploy with the files already here and not the release's — how `deploy.sh` behaved before #347. An escape hatch, not a mode to run in. |

An offline upgrade sets two of these: copy the release's tarball, its `.sha256`
and its images to the host, then
`DEPLOY_SKIP_PULL=1 DEPLOY_BUNDLE=./finance-stack-X.Y.Z.tar.gz ./deploy.sh X.Y.Z`.

### Doing it by hand

`deploy.sh` is not magic, and there is no state it keeps that you cannot recreate.
The equivalent manual sequence, if you need it:

```sh
docker compose exec pg-backup /scripts/backup.sh   # 1. and note the file it writes
ls -t backups/*.dump | head
REL=https://github.com/aellington89/finance-stack/releases/download/vX.Y.Z
curl -fsSLO "$REL/finance-stack-X.Y.Z.tar.gz"      # 2. fetch and verify the bundle
curl -fsSLO "$REL/finance-stack-X.Y.Z.tar.gz.sha256"
sha256sum -c finance-stack-X.Y.Z.tar.gz.sha256
tar xzf finance-stack-X.Y.Z.tar.gz                 # 3. install its files; keep .env
cp finance-stack-X.Y.Z/compose.yml finance-stack-X.Y.Z/.env.example \
   finance-stack-X.Y.Z/README.md finance-stack-X.Y.Z/finance-stack.service \
   finance-stack-X.Y.Z/deploy.sh .
diff caddy/Caddyfile finance-stack-X.Y.Z/caddy/Caddyfile   # merge by hand if you edited yours
sed -i 's/^APP_VERSION=.*/APP_VERSION=X.Y.Z/' .env  # 4. pin
docker compose pull                                 # 5. pull
docker compose up -d --remove-orphans               # 6. apply
curl -sS http://127.0.0.1:3001/api/health           # 7. check build.version
```

Note `exec` there and `run --entrypoint` in the script: `pg-backup`'s entrypoint is
a sleep loop, so a one-off run has to override it, while `exec` bypasses it.

## Customizing the stack

`deploy.sh` installs each release's `compose.yml`, so **local changes belong in
`compose.override.yml`** beside it. Compose reads that file on its own and merges
it over `compose.yml`, and `deploy.sh` never touches it. To move the app off port
3001, for example:

```yaml
# compose.override.yml
services:
  finance-app:
    ports: !override
      - "127.0.0.1:8080:3001"
```

`!override` replaces the list. Without it Compose appends to `ports`, and both
ports would be published. It needs Compose 2.24.4 or later (`docker compose
version`). Then point the health gate at the new port:
`DEPLOY_HEALTH_URL=http://127.0.0.1:8080/api/health ./deploy.sh`.

**If you edit `compose.yml` itself**, the next upgrade whose release changes that
file stops before doing anything and tells you so: installing the release's copy
would silently drop your edit. Move the edit into `compose.override.yml`, put the
shipped copy back with the command it prints, and re-run. An edit the release
leaves alone is kept, with a reminder.

**`caddy/Caddyfile` works the other way round.** The TLS setup tells you to edit
it in place (`tls internal`, an ACME `email`), and Caddy has no override file. An
edited Caddyfile is therefore kept on upgrade. When the release changes it too,
the release's copy is written beside yours as `caddy/Caddyfile.dist`, and the
upgrade's summary says so. Merge what you need:

```sh
diff caddy/Caddyfile caddy/Caddyfile.dist
```

Every upgrade keeps the files it replaced in `.bundle-backup/`, so nothing it
overwrites is lost.

## Backups

`pg-backup` dumps every database in `BACKUP_DBS` to `./backups/` on a loop
(daily by default, 14-day retention) and reports unhealthy if a dump goes
missing. **The dumps sit on the same host as the database they protect** — copy
them somewhere else. See
[Backups](https://github.com/aellington89/finance-stack/blob/master/docs/backups.md).

## Importing files

Drop files into a subdirectory of `imports/` named for the import type; the
importer polls every 60 seconds and routes each file to the matching parser in
`importer/parsers/`. Parsers are user-specific and are **not** shipped in this
bundle — an install with none logs a warning per unmatched import type and is
otherwise fine. See
[Importer](https://github.com/aellington89/finance-stack/blob/master/docs/importer.md).

## Optional services

Neither starts by default.

```sh
docker compose --profile bi up -d                    # Metabase, on 127.0.0.1:3000
docker compose --profile init run --rm init-script   # rebuild balance history
```

Once you have started one, upgrades keep it current. A plain `up -d` leaves a
running profile service on whatever definition it was started with, so after a
successful upgrade `deploy.sh` re-applies Metabase, GlitchTip or Caddy if one is
running. A Metabase version bump in a release therefore reaches the container,
not just `compose.yml`.

## Troubleshooting

```sh
docker compose ps                                    # what is up, and healthy
docker compose logs migrate                          # first stop for a failed start
docker compose logs finance-app | jq -c 'select(.level=="error")'
docker compose run --rm --entrypoint bash migrate /scripts/verify-db-roles.sh Finances   # role/grant drift
head -n1 compose.yml                                 # which release this compose.yml came from
diff .bundle-backup/compose.yml compose.yml          # what the last upgrade changed in it
```

`finance-app` will not start until `migrate` has exited 0, so a stack stuck with
no app is almost always a migrate failure — read that log first. `pg-backup`
reports unhealthy if no dump is newer than 1.5× the backup interval.
