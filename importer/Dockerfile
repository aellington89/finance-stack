# Importer service image (Issues #224, #132).
#
# Replaces the old arrangement, where the `importer` Compose service ran the
# stock python:3.14-slim image, bind-mounted ./importer over /app, and ran
# `pip install -r requirements.txt` on every container start. That needed
# internet access on each restart, re-resolved the dependency set outside the
# lockfile's control, and left the service unable to run from a registry image.
#
# What is baked and what is mounted:
#   baked   poll.py, lookups.py + the pinned deps from requirements.txt
#   mounted /app/parsers (user-specific, gitignored) and /input (the drop folder)
#
# Bumping this base is a Dependabot `docker` PR against /importer — see the
# entry in .github/dependabot.yml.
FROM python:3.14-slim

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
# setuptools is deliberately left in place. It is a separate finding
# (CVE-2025-47273), suppressed on its own entry, and pkg_resources is imported
# at runtime by more packages than is comfortable to bet on — so removing it is
# its own change with its own blast radius, not a rider on this one.
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
COPY poll.py lookups.py ./

# Non-root (#132). The importer only ever reads /input and /app/parsers and
# writes nothing to the filesystem — it inserts through the database connection —
# so it needs no ownership of either mount.
RUN useradd --system --uid 1001 --create-home importer
USER importer

# Published to GHCR on every vX.Y.Z tag (#226); the source label links the
# package back to this repository.
LABEL org.opencontainers.image.source="https://github.com/aellington89/finance-stack" \
      org.opencontainers.image.title="finance-importer" \
      org.opencontainers.image.description="Polling file importer for Finance Stack"

CMD ["python", "poll.py"]
