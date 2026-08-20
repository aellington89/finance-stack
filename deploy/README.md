# Finance Stack — deployment bundle

This directory is the **entire deployment**. There is no source tree, no Node,
and no build toolchain on the server: every service runs from a published image
pinned to one release, and only data is stored beside this file.

Packed as `finance-stack-X.Y.Z.tar.gz` and attached to every
[GitHub Release](https://github.com/aellington89/finance-stack/releases)
([Issue #227](https://github.com/aellington89/finance-stack/issues/227)).

```
/opt/finance-stack/
  compose.yml              the stack, images pinned to ${APP_VERSION}
  .env.example             copy to .env and fill in
  finance-stack.service    systemd unit
  caddy/Caddyfile          reverse-proxy config (--profile edge)
  README.md                this file
  imports/                 drop folder — one subdirectory per import type
  importer/parsers/        your parsers (user-specific, not shipped)
  backups/                 pg_dump output
```

## Requirements

Docker Engine with the Compose plugin. That is the whole list.

```sh
docker --version
docker compose version
```

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

# 4. Start. This pulls the images, waits for Postgres, runs the one-shot
#    migrate job (which creates the databases, roles and seeds), then starts
#    the app, importer and backup services.
docker compose up -d

# 5. Verify
curl -sS http://127.0.0.1:3001/api/health
docker compose ps
```

Generate a real `AUTH_SECRET` rather than editing the placeholder by hand:

```sh
openssl rand -base64 33
```

### Create the first user

There is no public registration, and **this is the one step the bundle cannot do
by itself.** The first-user CLI needs the application source and Node, which is
precisely what a deployment host does not have: the `finance-app` image ships the
standalone server with npm removed, and the `finance-migrate` image carries the
migration scripts but not `app/lib/`.

This is tracked as
[#288](https://github.com/aellington89/finance-stack/issues/288). Until it lands,
run the CLI from a machine that *does* have a checkout, over an SSH tunnel to
this host's Postgres (loopback-bound on 5433):

```sh
# On your workstation, in one terminal:
ssh -L 5433:127.0.0.1:5433 <host>

# In another, from the repository checkout:
cd app
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5433/Finances \
  npm run auth:create-user -- <username> [--role admin|user]
```

`<POSTGRES_PASSWORD>` is the value from this deployment's `.env`. It must connect
as `postgres`, not `finance_app` — the `users` table is deliberately read-only to
the application role (#130), so an app-level compromise cannot mint an account.
Re-running with an existing username resets that user's password.

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

> **This is the manual procedure.** [Issue
> #228](https://github.com/aellington89/finance-stack/issues/228) replaces it
> with `./deploy.sh <version>`, which adds a pre-upgrade backup gate, a health
> gate, and automatic rollback. Until then, take the dump yourself — step 1 is
> not optional.

**Read the release's `**Migration:**` marker first.** It is the first line of the
release notes and says whether rolling back needs a dump restore:

| Marker | Rolling back means |
|---|---|
| `none` | Re-pin the previous `APP_VERSION`. |
| `backward-compatible` | Re-pin the previous `APP_VERSION`. The old app runs against the new schema. |
| `breaking` | **Restore the pre-upgrade dump.** There are no down migrations. |

```sh
cd /opt/finance-stack

# 1. Take a backup and note the file it writes.
docker compose exec pg-backup /scripts/backup.sh
ls -t backups/*.dump | head

# 2. Pin the new version.
sed -i 's/^APP_VERSION=.*/APP_VERSION=X.Y.Z/' .env

# 3. Pull first — a bad or nonexistent version fails before anything running
#    is touched.
docker compose pull

# 4. Apply. migrate runs before the app starts, and the app does not start if
#    it fails.
docker compose up -d

# 5. Health-gate the result. build.version must equal the version from step 2.
curl -sS http://127.0.0.1:3001/api/health
```

### Rolling back

```sh
sed -i 's/^APP_VERSION=.*/APP_VERSION=<previous>/' .env
docker compose up -d
```

If the release was marked `breaking`, that is not sufficient on its own — restore
the dump from step 1 as well:

```sh
docker compose exec pg-backup /scripts/restore.sh --force Finances /backups/<file>.dump
```

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

## Troubleshooting

```sh
docker compose ps                                    # what is up, and healthy
docker compose logs migrate                          # first stop for a failed start
docker compose logs finance-app | jq -c 'select(.level=="error")'
docker compose exec pg-backup /scripts/verify-db-roles.sh   # role/grant drift
```

`finance-app` will not start until `migrate` has exited 0, so a stack stuck with
no app is almost always a migrate failure — read that log first. `pg-backup`
reports unhealthy if no dump is newer than 1.5× the backup interval.
