"""
Unit tests for the importer dispatch loop (issue #124).

No database: these cover the control flow — what gets skipped, what gets
quarantined, what propagates — using the fakes in conftest.py. The SQL itself,
the CHECK constraints and the partial unique index are covered against a real
database in test_import_log.py.
"""

import hashlib

import psycopg2
import pytest

import poll
from conftest import FakeConn, FakeParser


# ── hashing ───────────────────────────────────────────────────────────────


def test_sha256_file_matches_hashlib(tmp_path):
    target = tmp_path / "statement.pdf"
    target.write_bytes(b"some bytes")
    assert poll.sha256_file(str(target)) == hashlib.sha256(b"some bytes").hexdigest()


def test_sha256_file_spans_chunk_boundary(tmp_path):
    # Larger than HASH_CHUNK_BYTES and not a multiple of it, so a bug in the
    # chunked read loop shows up as a wrong digest rather than a short read.
    body = b"x" * (poll.HASH_CHUNK_BYTES * 2 + 17)
    target = tmp_path / "big.pdf"
    target.write_bytes(body)
    assert poll.sha256_file(str(target)) == hashlib.sha256(body).hexdigest()


def test_sha256_file_of_empty_file(tmp_path):
    target = tmp_path / "empty.pdf"
    target.write_bytes(b"")
    assert poll.sha256_file(str(target)) == hashlib.sha256(b"").hexdigest()


# ── error classification ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "exc",
    [
        psycopg2.OperationalError("server closed the connection unexpectedly"),
        psycopg2.InterfaceError("connection already closed"),
    ],
)
def test_connection_errors_are_recognised(exc):
    assert poll.is_connection_error(exc) is True


@pytest.mark.parametrize(
    "exc",
    [
        ValueError("Could not find Pay Date in PDF"),
        KeyError("accounts"),
        RuntimeError("boom"),
        psycopg2.DataError("invalid input syntax"),
        psycopg2.IntegrityError("violates foreign key constraint"),
    ],
)
def test_parser_errors_are_not_connection_errors(exc):
    assert poll.is_connection_error(exc) is False


# ── backoff ───────────────────────────────────────────────────────────────


def test_next_backoff_doubles():
    assert poll.next_backoff(60) == 120
    assert poll.next_backoff(120) == 240


def test_next_backoff_holds_at_the_cap():
    assert poll.next_backoff(poll.BACKOFF_CAP_SECONDS) == poll.BACKOFF_CAP_SECONDS
    assert poll.next_backoff(poll.BACKOFF_CAP_SECONDS * 10) == poll.BACKOFF_CAP_SECONDS


def test_next_backoff_grows_from_zero():
    # POLL_INTERVAL=0 is legal; without the max() guard the delay would stay 0
    # and the "backoff" would be a busy loop.
    assert poll.next_backoff(0) == 2


# ── the sweep ─────────────────────────────────────────────────────────────


def has_run(verbs, pattern):
    """True if `pattern` appears as a contiguous run inside `verbs`."""
    return any(
        verbs[i : i + len(pattern)] == pattern
        for i in range(len(verbs) - len(pattern) + 1)
    )


def run_sweep(monkeypatch, parser, input_dir, conn, retry_failed=False):
    monkeypatch.setattr(poll, "load_parser", lambda import_type: parser)
    return poll.poll_once(conn, {}, input_dir, retry_failed=retry_failed)


def test_new_file_is_imported(monkeypatch, drop_folder):
    parser = FakeParser()
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(monkeypatch, parser, drop_folder("march.pdf"), conn)

    assert stats == {"imported": 1, "skipped": 0, "failed": 0}
    assert parser.seen == ["march.pdf"]
    # The log row is written inside the parser's transaction, so one commit
    # immediately follows it and covers both.
    assert has_run(conn.verbs, ["INSERT", "commit"]), conn.verbs


def test_already_imported_file_is_skipped(monkeypatch, drop_folder):
    parser = FakeParser()
    conn = FakeConn(fetchone_result=("imported", None))
    stats = run_sweep(monkeypatch, parser, drop_folder("march.pdf"), conn)

    assert stats == {"imported": 0, "skipped": 1, "failed": 0}
    assert parser.seen == []
    assert "commit" not in conn.verbs


def test_a_sweep_never_sleeps_holding_a_transaction(monkeypatch, drop_folder):
    # lookup_import() opens a read transaction. A sweep where everything is
    # skipped commits nothing, so without an explicit rollback the poller sleeps
    # idle-in-transaction and blocks DDL on the lookup tables — which presents as
    # the whole stack hanging during `migrate`, not as an importer problem.
    parser = FakeParser()
    conn = FakeConn(fetchone_result=("imported", None))
    run_sweep(monkeypatch, parser, drop_folder("a.pdf", "b.pdf"), conn)

    assert conn.verbs[-1] in ("rollback", "commit"), conn.verbs


def test_quarantined_file_is_skipped(monkeypatch, drop_folder):
    parser = FakeParser()
    conn = FakeConn(fetchone_result=("failed", "ValueError: no pay date"))
    stats = run_sweep(monkeypatch, parser, drop_folder("broken.pdf"), conn)

    assert stats == {"imported": 0, "skipped": 1, "failed": 0}
    assert parser.seen == []


def test_the_repeated_quarantine_line_is_abbreviated(
    monkeypatch, drop_folder, capsys
):
    # This line reprints for every quarantined file on every poll, forever, so
    # it must not carry the whole 4000-character stored error.
    huge = "ValueError: " + "x" * 9_999
    parser = FakeParser()
    conn = FakeConn(fetchone_result=("failed", huge))
    run_sweep(monkeypatch, parser, drop_folder("broken.pdf"), conn)

    out = capsys.readouterr().out
    assert "…" in out
    assert len(out) < poll.SKIP_ERROR_TEXT_LIMIT + 500, len(out)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("short", "short"),
        ("", ""),
        (None, None),
        ("y" * 200, "y" * 200),
        ("y" * 201, "y" * 200 + "…"),
    ],
)
def test_abbreviate(text, expected):
    assert poll.abbreviate(text) == expected


def test_quarantined_file_is_retried_on_the_first_sweep_after_a_restart(
    monkeypatch, drop_folder
):
    # A restart is the signal that the operator may have fixed the parser.
    parser = FakeParser()
    conn = FakeConn(fetchone_result=("failed", "ValueError: no pay date"))
    stats = run_sweep(
        monkeypatch, parser, drop_folder("broken.pdf"), conn, retry_failed=True
    )

    assert stats == {"imported": 1, "skipped": 0, "failed": 0}
    assert parser.seen == ["broken.pdf"]


def test_parser_failure_is_quarantined_and_the_sweep_continues(
    monkeypatch, drop_folder
):
    # The heart of the issue: one bad file used to call sys.exit(1), so the two
    # good files behind it were never imported.
    parser = FakeParser(behaviour={"b.pdf": ValueError("unmatched field")})
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(monkeypatch, parser, drop_folder("a.pdf", "b.pdf", "c.pdf"), conn)

    assert stats == {"imported": 2, "skipped": 0, "failed": 1}
    assert parser.seen == ["a.pdf", "b.pdf", "c.pdf"]


def test_failure_is_recorded_only_after_the_rollback(monkeypatch, drop_folder):
    # The ordering bug this suite exists to prevent. Recording the failure
    # before the rollback rolls the record away too, leaving the file
    # unquarantined and re-parsed on every poll forever.
    parser = FakeParser(behaviour={"broken.pdf": ValueError("unmatched field")})
    conn = FakeConn(fetchone_result=None)
    run_sweep(monkeypatch, parser, drop_folder("broken.pdf"), conn)

    # The parser's work is rolled back, and only then is the quarantine row
    # inserted and committed — as one contiguous run, so nothing can have
    # committed in between.
    assert has_run(conn.verbs, ["rollback", "INSERT", "commit"]), conn.verbs
    # And the failure row is never inserted before that rollback.
    assert conn.verbs.index("rollback") < conn.verbs.index("INSERT"), conn.verbs


def test_connection_error_propagates_and_quarantines_nothing(
    monkeypatch, drop_folder
):
    # A database restart must not quarantine the whole drop folder.
    parser = FakeParser(
        behaviour={"a.pdf": psycopg2.OperationalError("server closed the connection")}
    )
    conn = FakeConn(fetchone_result=None)

    with pytest.raises(psycopg2.OperationalError):
        run_sweep(monkeypatch, parser, drop_folder("a.pdf", "b.pdf", "c.pdf"), conn)

    assert parser.seen == ["a.pdf"]
    assert "commit" not in conn.verbs


def unique_violation(constraint_name):
    """A UniqueViolation whose diag reports a given constraint."""

    class _Diag:
        pass

    diag = _Diag()
    diag.constraint_name = constraint_name

    class _Violation(psycopg2.errors.UniqueViolation):
        pass

    exc = _Violation("duplicate key value violates unique constraint")
    _Violation.diag = diag
    return exc


def test_dedup_index_violation_counts_as_a_skip(monkeypatch, drop_folder):
    # The partial unique index winning a check-then-act race with lookup_import.
    parser = FakeParser(behaviour={"march.pdf": unique_violation(poll.DEDUP_INDEX)})
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(monkeypatch, parser, drop_folder("march.pdf"), conn)

    assert stats == {"imported": 0, "skipped": 1, "failed": 0}
    assert "rollback" in conn.verbs
    assert "commit" not in conn.verbs


def test_a_parsers_own_unique_violation_is_quarantined(monkeypatch, drop_folder):
    # Not every duplicate key is *our* duplicate key. A parser colliding on a
    # constraint of its own is a real error, and reporting it as "already
    # imported" would be exactly the kind of quiet wrong answer this change
    # exists to remove.
    parser = FakeParser(
        behaviour={"march.pdf": unique_violation("transactions_some_other_key")}
    )
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(monkeypatch, parser, drop_folder("march.pdf"), conn)

    assert stats == {"imported": 0, "skipped": 0, "failed": 1}


def test_a_unique_violation_with_no_diagnostics_is_quarantined(
    monkeypatch, drop_folder
):
    parser = FakeParser(behaviour={"march.pdf": psycopg2.errors.UniqueViolation()})
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(monkeypatch, parser, drop_folder("march.pdf"), conn)

    assert stats == {"imported": 0, "skipped": 0, "failed": 1}


# ── the optional row_count return ─────────────────────────────────────────


@pytest.mark.parametrize(
    "returned,expected",
    [
        (12, 12),
        (0, 0),
        (None, None),
        # bool is a subclass of int; a parser returning True means "done", not
        # "one row".
        (True, None),
        ("12", None),
    ],
)
def test_row_count_is_taken_only_from_a_real_int(
    monkeypatch, drop_folder, returned, expected
):
    parser = FakeParser(default=returned)
    conn = FakeConn(fetchone_result=None)
    run_sweep(monkeypatch, parser, drop_folder("march.pdf"), conn)

    inserts = [
        params for sql, params in conn.executed if sql.strip().upper().startswith("INSERT")
    ]
    assert len(inserts) == 1
    assert inserts[0][-1] == expected


# ── folder scanning ───────────────────────────────────────────────────────


def test_import_type_without_a_parser_is_skipped(monkeypatch, drop_folder, capsys):
    monkeypatch.setattr(poll, "load_parser", lambda import_type: None)
    conn = FakeConn(fetchone_result=None)
    stats = poll.poll_once(conn, {}, drop_folder("march.pdf", subdir="bank-statements"))

    assert stats == {"imported": 0, "skipped": 0, "failed": 0}
    assert "no parser for 'bank-statements/'" in capsys.readouterr().out


def test_dotfiles_and_loose_files_are_ignored(monkeypatch, tmp_path, drop_folder):
    input_dir = drop_folder("march.pdf", ".partial-upload.pdf")
    # A file sitting directly in /input rather than in an import-type folder.
    (tmp_path / "README.txt").write_text("not an import type")

    parser = FakeParser()
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(monkeypatch, parser, input_dir, conn)

    assert parser.seen == ["march.pdf"]
    assert stats["imported"] == 1


def test_unreadable_file_is_skipped_not_quarantined(
    monkeypatch, drop_folder, capsys
):
    # No hash means no key to quarantine under, and a file that vanished between
    # listdir and open needs no decision recorded.
    parser = FakeParser()
    conn = FakeConn(fetchone_result=None)

    def explode(filepath):
        raise OSError("No such file or directory")

    monkeypatch.setattr(poll, "sha256_file", explode)
    stats = run_sweep(monkeypatch, parser, drop_folder("gone.pdf"), conn)

    assert stats == {"imported": 0, "skipped": 1, "failed": 0}
    assert parser.seen == []
    assert conn.executed == []
    assert "cannot read" in capsys.readouterr().out


# ── the two orderings that only fail silently ─────────────────────────────


def test_the_log_row_commits_with_the_parsers_work(monkeypatch, drop_folder):
    # If the parser's inserts were committed first and the log row second, a
    # crash between the two would leave transactions imported with nothing
    # recording that they were — and the next poll would import them again.
    # Asserted as a contiguous run so no commit can slip in between.
    conn = FakeConn(fetchone_result=None)

    class RecordingParser(FakeParser):
        def process(self, filepath, conn_, lookup_maps):
            conn_.note("parser")
            return super().process(filepath, conn_, lookup_maps)

    run_sweep(monkeypatch, RecordingParser(), drop_folder("march.pdf"), conn)

    assert has_run(conn.verbs, ["parser", "INSERT", "commit"]), conn.verbs


def test_connect_releases_the_lookup_snapshot(monkeypatch):
    # The importer must not hold an idle transaction for its whole life: the
    # snapshot blocks DDL on the three lookup tables, which surfaces as the
    # `migrate` service hanging rather than as an importer fault.
    conn = FakeConn(fetchall_result=[])
    monkeypatch.setattr(poll.psycopg2, "connect", lambda url: conn)

    returned, lookup_maps = poll.connect("postgresql://unused/unused")

    assert returned is conn
    assert set(lookup_maps) == {
        "accounts",
        "transaction_categories",
        "transaction_category_types",
    }
    assert conn.verbs[-1] == "rollback", conn.verbs
