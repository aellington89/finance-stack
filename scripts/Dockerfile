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

# ZLIB, KRB5 AND ZSTD COME FROM TRIXIE-SECURITY, NOT FROM THE BASE.
#
# zlib (DSA-6613-1): the same CVE-2026-76844 / CVE-2026-85091 finding, fix and
# reasoning as the identical layer in importer/Dockerfile, which explains it in
# full. Drop zlib1g from this layer once postgres:18.6 ships -deb13u1 itself.
#
# krb5 (DSA-6650-1): libkrb5-3, libk5crypto3, libkrb5support0 and
# libgssapi-krb5-2 1.21.3-5+deb13u1 carry fourteen HIGH CVEs (CVE-2026-71199,
# CVE-2026-71200, CVE-2026-107364, CVE-2026-112315 to -112323, CVE-2026-118380
# and CVE-2026-119079), fixed in -deb13u2. postgres:18.6, last rebuilt
# 2026-11-06, still carries -deb13u1, so re-running the scan can't clear them.
# libpq links GSSAPI, so the packages can't be removed. The four come from one
# source package and depend on each other's exact version, so they move
# together. Drop them from this layer once postgres:18.6 ships -deb13u2.
#
# zstd (DSA-6657-1): libzstd1 and the zstd tool 1.5.7+dfsg-1 report
# CVE-2026-124851 (HIGH, an information disclosure through an uninitialized
# buffer), fixed in 1.5.7+dfsg-1+deb13u1. postgres:18.6 still carries -1, so
# re-running the scan can't clear it. The tool depends on libzstd1 at its exact
# version, so the two move together. Drop them from this layer once postgres:18.6
# ships -deb13u1.
#
# `--only-upgrade` moves only the packages it names, so it cannot pull
# postgresql-18 forward from the pgdg repository and break the pg_dump version
# match described above, and the build fails unless every fixed version
# arrived. Both apt calls pass `-o Acquire::Retries=0` to stay off the path that
# apt 3.0.3's advisory (CVE-2026-109518) needs, should the base still carry it.
RUN apt-get -o Acquire::Retries=0 update \
 && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=0 install -y --only-upgrade \
      zlib1g libkrb5-3 libgssapi-krb5-2 libk5crypto3 libkrb5support0 libzstd1 zstd \
 && rm -rf /var/lib/apt/lists/* \
 && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' zlib1g)" ge '1:1.3.dfsg+really1.3.1-1+deb13u1' \
 && for p in libkrb5-3 libgssapi-krb5-2 libk5crypto3 libkrb5support0; do \
      dpkg --compare-versions "$(dpkg-query -W -f='${Version}' "$p")" ge '1.21.3-5+deb13u2' || exit 1; \
    done \
 && for p in libzstd1 zstd; do \
      dpkg --compare-versions "$(dpkg-query -W -f='${Version}' "$p")" ge '1.5.7+dfsg-1+deb13u1' || exit 1; \
    done

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
