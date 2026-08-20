# Backup/restore service image (Issue #224).
#
# Replaces the ./scripts bind mount on the `pg-backup` and `init-script`
# services, so the stack can run from a registry image with no source tree on
# the host. The scripts land at /scripts — the path they were mounted at — so
# every documented invocation still resolves unchanged, e.g.
#
#   docker compose exec pg-backup /scripts/backup.sh
#   docker compose exec pg-backup /scripts/restore.sh --force Finances Finances_Restore_Check
#
# BASE IMAGE CONSTRAINT: this must stay `FROM postgres:<same major as the
# server>`. pg_dump refuses to dump a server newer than itself, which is why
# scripts/backup.sh calls the version match out explicitly and why this is a
# separate image rather than a few extra files in the alpine-based `migrate`
# stage — its postgresql-client is not version-matched. Bump this tag in step
# with the `postgres` service in docker-compose.yml and the `postgres:` service
# containers in ci.yml and backup-smoke.yml.
#
# Dependabot reads this file under the `docker` ecosystem and docker-compose.yml
# under `docker-compose`, so it raises those as two separate PRs that must be
# merged together — see CONTRIBUTING.md "Dependabot PRs".
FROM postgres:18.6

COPY backup.sh restore.sh /scripts/
# Consumed by the one-shot `init-script` service (--profile init), which runs it
# through psql rather than executing it.
COPY update-account-balance-history.sql /scripts/

RUN chmod +x /scripts/backup.sh /scripts/restore.sh

# Published to GHCR on every vX.Y.Z tag (#226); the source label links the
# package back to this repository.
LABEL org.opencontainers.image.source="https://github.com/aellington89/finance-stack" \
      org.opencontainers.image.title="finance-backup" \
      org.opencontainers.image.description="Scheduled pg_dump backup, restore and balance-rebuild scripts for Finance Stack"

# No USER change. pg-backup writes dumps into the ./backups bind mount as the
# postgres image's default user, which is what works against a host-owned
# directory today.
