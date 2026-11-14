"""
The importer's liveness heartbeat, and its Compose healthcheck (issue #132).

The poll loop catches every exception and retries forever, which is what keeps
one bad file or a database restart from taking the service down. It is also why
a stalled importer used to be invisible. A hung parser, a wrong
FINANCE_IMPORTER_DB_PASSWORD and an /input the container cannot read all left
the container `Up` in `docker ps` while nothing was imported.

poll.py touches HEARTBEAT_FILE whenever the loop makes progress: after each file
it handles, and once at the end of every sweep that completes. A cycle that
fails never gets that closing beat, and the backoff before each retry doubles,
so a loop that fails every cycle goes stale within a few retries, just like one
that has hung. Run as a script, this module is the healthcheck. It exits 0 while
the file is fresh and 1 once it is older than limit_for(POLL_INTERVAL), and
Docker marks the container unhealthy after the configured retries.

WHY A FILE OF ITS OWN, not `poll.py --healthcheck`. The healthcheck lives in the
compose files and the code lives in the image, so the two can disagree. A dev
host that takes this change and runs `docker compose up` without a rebuild keeps
its old finance-importer:latest. That image's poll.py ignores its arguments, so
`python /app/poll.py --healthcheck` would start a second, complete poller every
minute, with retry_failed=True, re-parsing every quarantined file. A file the
old image does not have fails closed instead: python exits 2 ("can't open
file"), the container reads unhealthy, and nothing else happens.

Standard library only, because a probe should be cheap. It runs every minute
inside the importer's CPU limit and has no use for psycopg2.
"""

import os
import pathlib
import sys
import time

# /tmp because it is the one place uid 1001 can write: /app is root-owned, and
# the two mounts are the user's documents and parsers. It is in the container's
# own layer, so `docker restart` keeps it. poll() clears it at startup for that
# reason, so a beat from the last run never vouches for this one.
HEARTBEAT_FILE = "/tmp/importer-heartbeat"

# The floor under the limit. Without it, POLL_INTERVAL=5 would allow fifteen
# seconds, and one slow PDF would read as a stall.
MIN_LIMIT_SECONDS = 120

DEFAULT_POLL_INTERVAL = 60


def read_poll_interval(environ=None):
    """
    POLL_INTERVAL from the environment, in seconds.

    This is the one place it is parsed. The healthcheck runs as a separate
    process, and it has to judge the loop by the interval the loop is actually
    using. Docker gives a probe the container's environment, so reading it the
    same way here is what makes the two agree.
    """
    environ = os.environ if environ is None else environ
    return int(environ.get("POLL_INTERVAL", DEFAULT_POLL_INTERVAL))


def limit_for(poll_interval):
    """
    How old the heartbeat may get before it is stale.

    Three intervals. In steady state the gap between beats is one interval plus
    the time one file takes. One failed cycle, such as a Postgres restart, adds
    one backoff of the same length, so the gap grows to about two intervals and
    still passes. Two failed cycles in a row do not, because the backoff doubles.
    """
    return max(3 * poll_interval, MIN_LIMIT_SECONDS)


def _resolve(path):
    # Looked up at call time rather than bound as a default argument, so a test
    # can point the whole module somewhere else by patching HEARTBEAT_FILE.
    return HEARTBEAT_FILE if path is None else path


def beat(path=None):
    """
    Record progress by touching the heartbeat file. True if it was written.

    Never raises. The heartbeat is instrumentation, and a full or unwritable
    /tmp must not stop an import. A write that fails leaves the file stale,
    which makes the healthcheck report what is true: this container can no
    longer show that it is making progress.
    """
    try:
        pathlib.Path(_resolve(path)).touch()
        return True
    except OSError:
        return False


def clear(path=None):
    """Remove the heartbeat file if there is one. Never raises."""
    try:
        os.unlink(_resolve(path))
    except OSError:
        pass


def check(path=None, limit=None, now=None):
    """
    (fresh, reason) for the heartbeat file.

    A missing file is stale: it means no cycle has made progress since the
    importer started. An mtime in the future, from a clock that stepped back, is
    fresh. Nothing about it says the loop has stopped. The reason is printed by
    main(), and Docker keeps it in `.State.Health.Log`, so it names the age and
    the limit.
    """
    target = _resolve(path)
    limit = limit_for(read_poll_interval()) if limit is None else limit
    now = time.time() if now is None else now

    try:
        mtime = os.stat(target).st_mtime
    except FileNotFoundError:
        return (
            False,
            f"no heartbeat at {target}: no poll cycle has made progress since "
            f"the importer started (limit {limit}s)",
        )
    except OSError as exc:
        return False, f"cannot read the heartbeat at {target}: {exc}"

    age = now - mtime
    if age <= limit:
        return True, f"last progress {max(age, 0):.0f}s ago (limit {limit}s)"
    return (
        False,
        f"last progress {age:.0f}s ago, over the {limit}s limit: the poll loop "
        f"is stuck or failing every cycle (see `docker compose logs importer`)",
    )


def main():
    """The healthcheck: print why, and exit 0 if fresh or 1 if not."""
    fresh, reason = check()
    print(reason, flush=True)
    return 0 if fresh else 1


if __name__ == "__main__":
    sys.exit(main())
