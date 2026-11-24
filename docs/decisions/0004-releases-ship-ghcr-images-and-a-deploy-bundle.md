# 0004. Releases ship GHCR images and a deploy bundle, with a migration marker for rollback

Date: 2026-08-22 · Status: Accepted · Issue: #223

## Context

Before [Issue #223](https://github.com/aellington89/finance-stack/issues/223), `release.yml` built
and verified `finance-app` and then threw the image away. Deploying meant cloning the repository
onto a server and building Next.js there: slow, memory-hungry, and not the image CI verified.
Separately, migrations have no down scripts ([0001](0001-drizzle-migrations-are-the-schema-source-of-truth.md)),
so whether an operator can roll back by re-pinning the previous image depends on the release, and
nothing said which (Issue #277). Recorded on 2026-11-23 from
[deployment.md](../deployment.md) and [releases.md](../releases.md).

## Decision

- A `v*` tag builds, boots and verifies four versioned images (`finance-app`, `finance-migrate`,
  `finance-importer`, `finance-backup`) and publishes them to GHCR, with a self-contained deploy
  bundle (`deploy/`, packed by `scripts/pack-bundle.sh`) on the GitHub Release.
- A server installs the bundle and upgrades with one command, `deploy.sh`: pull, take a backup
  that must succeed, pin `APP_VERSION`, apply, poll `/api/health` for the new version, and on
  failure put the previous version back.
- Every release in `CHANGELOG.md` declares `**Migration:**` as `none`, `backward-compatible`
  (re-pinning the previous image is enough), or `breaking` (restore the pre-upgrade dump). The
  changelog gate enforces it, and a `breaking` one also starts its entry `**Breaking:**`.

## Consequences

- The running image is the one CI verified, and a server needs no build toolchain.
- `docker-compose.yml` (development) and `deploy/compose.yml` (servers) describe the same services
  and must stay in step; `scripts/check-deploy-parity.sh` gates it in CI, and Dependabot's image
  bumps need the second file edited by hand.
- Each PR that changes the schema sets or escalates the marker while its author still knows the
  answer.
- `deploy.sh` never decides on its own whether a `breaking` release also needs its database
  restored: it exits 2 for a clean rollback and 3 when the rollback also failed, and there is no
  upgrade timer.

## Alternatives considered

- **Build on the server from a checkout.** The state before #223.
- **Unattended upgrades on a timer.** Rejected: rolling back a `breaking` release needs a person.
- **Down migrations.** Drizzle doesn't generate them, and the marker plus the backup gate covers
  the same need without hand-written reverse SQL.
