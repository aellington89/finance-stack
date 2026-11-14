# Importer service image (Issues #224, #132).
#
# Replaces the old arrangement, where the `importer` Compose service ran the
# stock python:3.14-slim image, bind-mounted ./importer over /app, and ran
# `pip install -r requirements.txt` on every container start. That needed
# internet access on each restart, re-resolved the dependency set outside the
# lockfile's control, and left the service unable to run from a registry image.
#
# What is baked and what is mounted:
#   baked   poll.py, lookups.py, heartbeat.py + the pinned deps from requirements.txt
#   mounted /app/parsers (user-specific, gitignored) and /input (the drop folder)
#
# Bumping this base is a Dependabot `docker` PR against /importer — see the
# entry in .github/dependabot.yml.
FROM python:3.15-slim

# ZLIB COMES FROM TRIXIE-SECURITY, NOT FROM THE BASE (DSA-6613-1). The base ships
# zlib1g 1:1.3.dfsg+really1.3.1-1+b1, which reports CVE-2026-76844 and
# CVE-2026-85091 (two HIGH heap overflows in zlib's gz* write path) against the
# `image` gate. Debian fixed both in -1+deb13u1, in trixie-security since
# 2026-11-02, but the upstream rebuilds since then (python:3.15-slim on
# 2026-11-07, postgres:18.6 on 2026-11-06) still carried -1+b1, so re-running the
# job could not clear them. Taking the one fixed package here is CONTRIBUTING.md's
# fix option 3 applied below the base, and it ranks above suppressing the finding.
# scripts/Dockerfile carries the same layer for the same reason.
#
# This is the image's only apt step, so it stays off the path a base still on
# apt 3.0.3 would expose (CVE-2026-109518; both bases have since moved to 3.0.4).
# That advisory requires Acquire::Retries above zero, so both calls pass
# `-o Acquire::Retries=0`. `--only-upgrade` moves zlib1g alone, and the lists are
# deleted in the same layer, so the image keeps no apt state.
#
# The last line is the layer asserting its own outcome. A security mirror that
# served nothing would otherwise look exactly like success, so the build fails
# unless the installed zlib1g is at least the fixed version. Once the base ships
# -deb13u1 itself, the upgrade is a no-op and the assertion still holds; delete
# the layer then.
RUN apt-get -o Acquire::Retries=0 update \
 && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=0 install -y --only-upgrade zlib1g \
 && rm -rf /var/lib/apt/lists/* \
 && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' zlib1g)" ge '1:1.3.dfsg+really1.3.1-1+deb13u1'

WORKDIR /app

# The poll loop's progress is its interface; it already passes flush=True, but
# this covers the tracebacks and anything a parser prints.
ENV PYTHONUNBUFFERED=1

# Its own layer, ahead of the source copy, so editing poll.py does not reinstall
# the dependency set.
#
# PIP IS REMOVED IN THE SAME LAYER, and that is a fix rather than tidying. pip
# vendors its own HTTP stack under pip/_vendor/, so urllib3 2.7.0 ships inside
# this image and reported CVE-2026-97687 (traffic interception through an HTTPS
# proxy TLS override) and CVE-2026-97689 against the `image` gate. Nothing
# installable reaches a vendored copy: pinning urllib3 in requirements.txt would
# add a second, top-level copy and leave the vulnerable vendored one exactly
# where it was. Removing the component instead is CONTRIBUTING.md's fix option 2
# and the end state .trivyignore already proposed for this image — "could be
# removed outright if the importer image ever drops pip after the install layer".
# It also takes pip's vendored msgpack with it.
#
# NOTHING HERE NEEDS PIP AT RUNTIME. The CMD is `python poll.py`; poll.py loads
# parsers with importlib.import_module rather than installing them; no module
# under importer/ mentions pip or subprocess; and docker-compose.yml's importer
# service says "no runtime pip install" in as many words. requirements.txt
# records when that stopped being true — pdfplumber is pinned here precisely so
# parsers no longer self-install at import time.
#
# THE ONE RESIDUAL RISK is a parser under the mounted, gitignored /app/parsers
# that still shells out to pip. This repository cannot see those. Such a parser
# is already broken on this image for anything touching site-packages, since the
# container runs as non-root uid 1001, but `pip install --user` would have
# worked before this change and will now fail with "No module named pip".
#
# SETUPTOOLS GOES TOO, which was not the plan and is recorded because the wrong
# half was the reasoning. This layer removes only pip: setuptools looked like a
# separate finding (CVE-2025-47273) on a top-level site-package, and
# pkg_resources is imported at runtime by more packages than is comfortable to
# bet on, so it was deliberately left alone rather than ridden along. CI then
# reported BOTH that entry and the msgpack one as matching nothing. The old
# suppression had it right all along — "it is present because the image ships
# pip" — so pip was the only thing holding setuptools in the image, and the
# imports below prove nothing here needed pkg_resources either. Both entries are
# gone from .trivyignore; the empty block there carries the rest of the story.
#
# The uninstall is best-effort and the `rm -rf` is the guarantee: `pip uninstall
# pip` is the tidy path — it takes the console scripts and dist-info with it —
# but it has historically warned-and-skipped rather than failed in some layouts,
# and a non-zero exit there would break the chain before the removal it was only
# helping with. So the last two lines are the layer asserting its own outcome,
# because a silent no-op here would look exactly like success: the imports prove
# the runtime dependencies survived the purge, and the `! python -c "import pip"`
# proves pip is actually gone rather than merely unlinked from PATH.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && { python -m pip uninstall --yes pip || true; } \
 && rm -rf /usr/local/lib/python3*/site-packages/pip \
           /usr/local/lib/python3*/site-packages/pip-*.dist-info \
           /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.* \
 && python -c "import pdfplumber, psycopg2" \
 && ! python -c "import pip" 2>/dev/null

# lookups.py alongside poll.py rather than inside it: parsers under the mounted
# /app/parsers import it directly for name-based PK resolution (#273), and /app
# is already sys.path[0] because poll.py runs as a top-level script.
#
# heartbeat.py is the Compose healthcheck (#132), run as `python
# /app/heartbeat.py`. It is a file of its own rather than a flag on poll.py so
# that an older image, which does not have it, fails the probe instead of
# starting a second poller. See the module docstring.
COPY poll.py lookups.py heartbeat.py ./

# Non-root (#132). The importer only ever reads /input and /app/parsers — it
# inserts through the database connection — so it needs no ownership of either
# mount. The one file it writes is the heartbeat, /tmp/importer-heartbeat, and
# /tmp is world-writable in the base image, so that needs no ownership either.
# A future `read_only: true` root filesystem would need a tmpfs on /tmp.
RUN useradd --system --uid 1001 --create-home importer
USER importer

# Published to GHCR on every vX.Y.Z tag (#226); the source label links the
# package back to this repository.
LABEL org.opencontainers.image.source="https://github.com/aellington89/finance-stack" \
      org.opencontainers.image.title="finance-importer" \
      org.opencontainers.image.description="Polling file importer for Finance Stack"

CMD ["python", "poll.py"]
