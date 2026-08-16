# Importer service image (Issues #224, #132).
#
# Replaces the old arrangement, where the `importer` Compose service ran the
# stock python:3.14-slim image, bind-mounted ./importer over /app, and ran
# `pip install -r requirements.txt` on every container start. That needed
# internet access on each restart, re-resolved the dependency set outside the
# lockfile's control, and left the service unable to run from a registry image.
#
# What is baked and what is mounted:
#   baked   poll.py + the pinned deps from requirements.txt
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
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY poll.py ./

# Non-root (#132). The importer only ever reads /input and /app/parsers and
# writes nothing to the filesystem — it inserts through the database connection —
# so it needs no ownership of either mount.
RUN useradd --system --uid 1001 --create-home importer
USER importer

CMD ["python", "poll.py"]
