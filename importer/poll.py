"""
Importer — polls subdirectories under /input for new files and routes
each one to a matching parser module in /app/parsers/.

To add a new import type:
  1. Create a subdirectory under imports/ (e.g., imports/bank-statements/)
  2. Create a matching parser at importer/parsers/bank_statements.py
     (directory name with hyphens converted to underscores)
  3. The parser module must expose a process(filepath, conn, lookup_maps)
     function. It may return the number of rows it inserted; anything else
     (including None) is recorded as an unknown count.

Subdirectories without a matching parser are skipped with a warning.

Every file is hashed and recorded in the `import_log` table (issue #124), which
gives the loop two properties it did not have before:

  Idempotent — a file whose sha256 already carries an 'imported' row is skipped.
  Re-dropping the same bytes under any name is a no-op, so the drop folder can
  be left alone and parsers no longer need duplicate guards of their own.

  Non-fatal — a parser exception quarantines that one file and the loop moves
  on, instead of calling sys.exit(1) and having the container restart straight
  back onto the same file forever. Unmatched fields are still a hard failure for
  the file they occur in; they are simply no longer a hard failure for the
  service. Nothing is ever moved or deleted on disk — the quarantine is a row,
  not a directory. See docs/importer.md.

Quarantine is keyed on content, so fixing the file lifts it automatically; a
restart lifts it too, on the assumption that the operator changed the parser.
"""

import hashlib
import importlib
import os
import sys
import time
import traceback

import psycopg2

INPUT_DIR = "/input"
PARSERS_DIR = "/app/parsers"
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", 60))

# Statements are read in chunks rather than slurped: these are PDFs, and the
# container is capped at 512M.
HASH_CHUNK_BYTES = 64 * 1024

# Backoff is derived from POLL_INTERVAL rather than configured separately. A
# knob here would have to be mirrored in docker-compose.yml, deploy/compose.yml
# and both .env.example files to satisfy scripts/check-deploy-parity.sh, which
# is a lot of surface for a value nobody tunes.
BACKOFF_CAP_SECONDS = 900

# error_text is unbounded in the schema, but a pdfplumber traceback repeated on
# every poll is not worth the storage. The full traceback still goes to stderr.
ERROR_TEXT_LIMIT = 4000

# How much of it to echo when re-announcing an already-quarantined file. That
# line reprints once per file per poll — every 60s, indefinitely, for as long as
# the file sits there — so the stored limit above is the wrong budget for it.
# The full text is one SELECT away in import_log, and was printed in full when
# the failure actually happened.
SKIP_ERROR_TEXT_LIMIT = 200

# The partial unique index from migration 0007. Named here so a duplicate import
# can be told apart from a unique violation raised by a parser against its own
# tables, which is a real error and must be quarantined like any other.
DEDUP_INDEX = "idx_import_log_sha256_imported"


def sha256_file(filepath):
    """Hex sha256 of a file's contents, read in chunks."""
    digest = hashlib.sha256()
    with open(filepath, "rb") as handle:
        for chunk in iter(lambda: handle.read(HASH_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def abbreviate(text, limit=SKIP_ERROR_TEXT_LIMIT):
    """
    `text` clipped to `limit` with an ellipsis, for a line that repeats.

    Tolerates NULL error_text: the CHECK constraint makes that impossible for a
    'failed' row, but this runs against whatever the table actually holds.
    """
    if not text:
        return text
    return text if len(text) <= limit else text[:limit] + "…"


def is_connection_error(exc):
    """
    True for failures of the connection itself rather than of the file.

    This distinction is the whole reason the loop can stop calling sys.exit(1)
    safely. If every exception quarantined its file, a routine database restart
    would quarantine every good file in the drop folder — a far worse outcome
    than the crash loop being fixed. Connection failures abandon the cycle and
    are retried with backoff; nothing is recorded against the file, because the
    file was never the problem.
    """
    return isinstance(exc, (psycopg2.OperationalError, psycopg2.InterfaceError))


def is_duplicate_import(exc):
    """
    True only when the import_log dedup index rejected the insert — i.e. these
    bytes were imported between lookup_import() and the INSERT.

    Scoped to that one index on purpose. Treating *any* unique violation as a
    duplicate would silently swallow a parser inserting a conflicting row of its
    own and report the file as already imported, which is the kind of quiet
    wrong answer this whole change exists to remove.
    """
    return (
        isinstance(exc, psycopg2.errors.UniqueViolation)
        and getattr(exc.diag, "constraint_name", None) == DEDUP_INDEX
    )


def load_lookup_maps(conn):
    """Load reference data from the database for PK resolution."""
    maps = {}
    with conn.cursor() as cur:
        cur.execute("SELECT account_id, account_name FROM accounts")
        maps["accounts"] = {row[1]: row[0] for row in cur.fetchall()}

        cur.execute("SELECT transaction_category_id, transaction_category FROM transaction_categories")
        maps["transaction_categories"] = {row[1]: row[0] for row in cur.fetchall()}

        cur.execute("SELECT transaction_type_id, transaction_type FROM transaction_types")
        maps["transaction_category_types"] = {row[1]: row[0] for row in cur.fetchall()}
    return maps


def load_parser(import_type):
    """Load a parser module by import type name (e.g., 'paystubs' -> parsers.paystubs)."""
    module_name = import_type.replace("-", "_")
    try:
        return importlib.import_module(f"parsers.{module_name}")
    except ModuleNotFoundError:
        return None


def lookup_import(conn, sha256):
    """
    The most recent import_log row for this content, as (status, error_text),
    or None if these bytes have never been seen.

    Newest-first rather than "any row", because a file can legitimately have a
    history: failed, then imported once the parser was fixed. The latest row is
    the one that describes where it stands now.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status, error_text FROM import_log "
            "WHERE sha256 = %s ORDER BY import_id DESC LIMIT 1",
            (sha256,),
        )
        return cur.fetchone()


def record_success(conn, import_type, file_name, sha256, row_count):
    """
    Record an import inside the parser's still-open transaction.

    Deliberately does not commit: the caller commits once, so the transactions
    and the row saying they were imported land together or not at all. Splitting
    them would let a crash in between leave imported rows with no log entry —
    which the next poll would import all over again.
    """
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO import_log (import_type, file_name, sha256, status, row_count) "
            "VALUES (%s, %s, %s, 'imported', %s)",
            (import_type, file_name, sha256, row_count),
        )


def record_failure(conn, import_type, file_name, sha256, error_text):
    """
    Record a failure in a transaction of its own, and commit it.

    The caller MUST have rolled the parser's work back first. Recording the
    failure before the rollback would roll the record away with it, leaving the
    file unquarantined and retried on every poll forever — the loop this change
    exists to end.
    """
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO import_log (import_type, file_name, sha256, status, error_text) "
            "VALUES (%s, %s, %s, 'failed', %s)",
            (import_type, file_name, sha256, error_text[:ERROR_TEXT_LIMIT]),
        )
    conn.commit()


def next_backoff(current, cap=BACKOFF_CAP_SECONDS):
    """Double the delay up to the cap. `max(current, 1)` so POLL_INTERVAL=0 still grows."""
    return min(max(current, 1) * 2, cap)


def process_file(conn, parser, lookup_maps, import_type, subdir, filename, retry_failed):
    """
    Handle one file. Returns the stats key it should be counted under.

    Raises only connection-level errors — everything else is recorded against
    the file and swallowed, so the caller's loop reaches the next file.
    """
    filepath = os.path.join(subdir, filename)

    try:
        sha256 = sha256_file(filepath)
    except OSError as exc:
        # Unreadable, or gone between listdir and open. Not quarantinable: with
        # no hash there is no key to quarantine it under, and a file that has
        # vanished needs no decision. Next poll will see it if it comes back.
        print(f"WARNING [{import_type}] {filename}: cannot read ({exc}) — skipping.", flush=True)
        return "skipped"

    previous = lookup_import(conn, sha256)
    if previous is not None:
        status, error_text = previous
        if status == "imported":
            print(f"[{import_type}] Skipping {filename}: already imported.", flush=True)
            return "skipped"
        if not retry_failed:
            print(
                f"[{import_type}] Skipping {filename}: quarantined by an earlier "
                f"failure ({abbreviate(error_text)}). Edit the file, or fix the "
                f"parser and restart the importer, to retry it.",
                flush=True,
            )
            return "skipped"
        print(
            f"[{import_type}] Retrying {filename} after an earlier failure — "
            f"the importer has restarted since.",
            flush=True,
        )

    print(f"[{import_type}] Processing: {filename}", flush=True)
    try:
        result = parser.process(filepath, conn, lookup_maps)
        # bool is an int in Python, and a parser returning True meaning "done"
        # must not be recorded as one row.
        row_count = result if isinstance(result, int) and not isinstance(result, bool) else None
        record_success(conn, import_type, filename, sha256, row_count)
        conn.commit()
        print(f"[{import_type}] Imported: {filename}", flush=True)
        return "imported"
    except Exception as exc:
        if is_connection_error(exc):
            raise
        if is_duplicate_import(exc):
            # The dedup index caught a duplicate that lookup_import missed.
            # lookup_import + INSERT is check-then-act; this is the index making
            # the race benign rather than the second import winning.
            conn.rollback()
            print(
                f"[{import_type}] Skipping {filename}: already imported "
                f"(detected on insert).",
                flush=True,
            )
            return "skipped"
        traceback.print_exc()
        conn.rollback()
        error_text = f"{type(exc).__name__}: {exc}"
        record_failure(conn, import_type, filename, sha256, error_text)
        print(
            f"FAILED [{import_type}] {filename}: {error_text} — quarantined, "
            f"continuing.",
            file=sys.stderr,
            flush=True,
        )
        return "failed"


def connect(database_url):
    """
    Open the importer's connection and load the lookup maps from it.

    Split out of poll() so the rollback below can be tested. Without it the
    importer sits idle-in-transaction for its entire life on the snapshot that
    the lookup reads opened, holding a lock that blocks DDL on accounts,
    transaction_categories and transaction_types — which surfaces as the
    `migrate` service hanging and reads as a whole-stack outage rather than as
    an importer problem.
    """
    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    lookup_maps = load_lookup_maps(conn)
    conn.rollback()
    return conn, lookup_maps


def poll_once(conn, lookup_maps, input_dir, retry_failed=False):
    """
    Run exactly one sweep of the drop folder. Returns counts by outcome.

    Split out from poll() so the sweep can be exercised without a loop to break
    out of — see importer/tests/test_poll.py.
    """
    stats = {"imported": 0, "skipped": 0, "failed": 0}

    for entry in sorted(os.listdir(input_dir)):
        subdir = os.path.join(input_dir, entry)
        if not os.path.isdir(subdir):
            continue

        files = sorted(
            f
            for f in os.listdir(subdir)
            if os.path.isfile(os.path.join(subdir, f))
            and not f.startswith(".")
        )
        if not files:
            continue

        parser = load_parser(entry)
        if parser is None:
            print(
                f"WARNING: no parser for '{entry}/' — skipping {len(files)} file(s). "
                f"Create parsers/{entry.replace('-', '_')}.py to handle this type.",
                flush=True,
            )
            continue

        for filename in files:
            outcome = process_file(
                conn, parser, lookup_maps, entry, subdir, filename, retry_failed
            )
            stats[outcome] += 1

    # Imports and failures end their own transactions, but a sweep that only
    # skipped files leaves the last lookup_import() SELECT open — and the loop
    # then sleeps on it. That is the idle-in-transaction hold that blocks DDL on
    # the lookup tables and surfaces as the `migrate` service hanging, so the
    # connection is returned to idle before the caller sleeps.
    conn.rollback()
    return stats


def poll():
    database_url = os.environ["DATABASE_URL"]
    input_dir = os.environ.get("INPUT_DIR", INPUT_DIR)

    conn = None
    lookup_maps = None
    backoff = POLL_INTERVAL
    # A restart is the only signal available that a parser may have changed, so
    # the first sweep gives previously-failed files one more chance. Later
    # sweeps leave them quarantined; otherwise a permanently bad file would be
    # re-parsed every minute forever.
    retry_failed = True

    print(f"Polling {input_dir} subdirectories every {POLL_INTERVAL}s...", flush=True)
    while True:
        try:
            if conn is None or conn.closed:
                print("Connecting to database...", flush=True)
                conn, lookup_maps = connect(database_url)
                print(
                    f"Loaded {sum(len(v) for v in lookup_maps.values())} reference rows "
                    f"across {len(lookup_maps)} tables.",
                    flush=True,
                )

            stats = poll_once(conn, lookup_maps, input_dir, retry_failed=retry_failed)
            if stats["imported"] or stats["failed"]:
                print(
                    f"Cycle complete: {stats['imported']} imported, "
                    f"{stats['failed']} failed, {stats['skipped']} skipped.",
                    flush=True,
                )

            retry_failed = False
            backoff = POLL_INTERVAL
            time.sleep(POLL_INTERVAL)
        except Exception as exc:
            # Only connection-level failures and bugs in the loop itself reach
            # here; per-file parser failures were handled in process_file.
            traceback.print_exc()
            print(f"Poll cycle failed: {exc}", file=sys.stderr, flush=True)
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
                conn = None
            print(f"Retrying in {backoff}s.", file=sys.stderr, flush=True)
            time.sleep(backoff)
            backoff = next_backoff(backoff)


if __name__ == "__main__":
    poll()
