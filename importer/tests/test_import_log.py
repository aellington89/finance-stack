"""
Integration tests for the import_log table (issue #124).

These need a real database: they cover the guarantees that live in the schema
rather than in poll.py — the partial unique index, the two CHECK constraints,
and the fact that finance_importer can append to the table but not rewrite it.
Running as finance_importer is deliberate, so the suite also proves the grants
in init-db/roles/02-grants.sql were actually applied.

Skipped unless IMPORTER_DATABASE_URL is set. CI sets it in the `ci` job, which
has already applied the migrations and the grants by that point.
"""

import os
import uuid

import psycopg2
import pytest

import poll

IMPORTER_URL = os.environ.get("IMPORTER_DATABASE_URL")
# Optional: used only to clean up the one row a test has to commit.
ADMIN_URL = os.environ.get("ADMIN_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not IMPORTER_URL, reason="IMPORTER_DATABASE_URL is not set"
)


def a_hash():
    """A distinct, correctly-sized sha256 that cannot collide with a real file."""
    return uuid.uuid4().hex + uuid.uuid4().hex


INSERT = (
    "INSERT INTO import_log (import_type, file_name, sha256, status, error_text) "
    "VALUES (%s, %s, %s, %s, %s)"
)


@pytest.fixture
def conn():
    """A finance_importer connection whose work is rolled back after each test."""
    connection = psycopg2.connect(IMPORTER_URL)
    connection.autocommit = False
    yield connection
    connection.rollback()
    connection.close()


# ── the idempotency guarantee ─────────────────────────────────────────────


def test_partial_unique_index_blocks_a_second_import(conn):
    sha = a_hash()
    with conn.cursor() as cur:
        cur.execute(INSERT, ("paystubs", "march.pdf", sha, "imported", None))
    with pytest.raises(psycopg2.errors.UniqueViolation):
        with conn.cursor() as cur:
            # A different name, the same bytes — which is exactly the case
            # poll.py's SELECT would miss if it raced with itself.
            cur.execute(INSERT, ("paystubs", "march-copy.pdf", sha, "imported", None))


def test_the_dedup_index_is_named_as_poll_expects(conn):
    """
    poll.DEDUP_INDEX is how a duplicate import is told apart from a unique
    violation a parser raised on its own tables. If the migration ever renames
    the index, that check stops matching and duplicates start being quarantined
    as failures instead of skipped — a silent degradation with no error anywhere,
    which is exactly why this is asserted rather than assumed.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT indexdef FROM pg_indexes "
            "WHERE tablename = 'import_log' AND indexname = %s",
            (poll.DEDUP_INDEX,),
        )
        row = cur.fetchone()
    assert row is not None, f"no index named {poll.DEDUP_INDEX} on import_log"
    indexdef = row[0]
    assert "UNIQUE" in indexdef, indexdef
    # Partial, so repeated failures of one file can still accumulate.
    assert "WHERE" in indexdef and "imported" in indexdef, indexdef


def test_a_dedup_violation_reports_the_constraint_name(conn):
    # The other half of the contract: psycopg2 must actually surface the index
    # name in diag.constraint_name, which is what poll.is_duplicate_import reads.
    sha = a_hash()
    with conn.cursor() as cur:
        cur.execute(INSERT, ("paystubs", "march.pdf", sha, "imported", None))
    try:
        with conn.cursor() as cur:
            cur.execute(INSERT, ("paystubs", "copy.pdf", sha, "imported", None))
        raise AssertionError("expected a UniqueViolation")
    except psycopg2.errors.UniqueViolation as exc:
        assert exc.diag.constraint_name == poll.DEDUP_INDEX
        assert poll.is_duplicate_import(exc) is True


def test_repeated_failures_of_the_same_file_are_allowed(conn):
    # The index is partial for this reason: a file that fails on every restart
    # must be able to accumulate history.
    sha = a_hash()
    with conn.cursor() as cur:
        cur.execute(INSERT, ("paystubs", "broken.pdf", sha, "failed", "first"))
        cur.execute(INSERT, ("paystubs", "broken.pdf", sha, "failed", "second"))
        cur.execute("SELECT count(*) FROM import_log WHERE sha256 = %s", (sha,))
        assert cur.fetchone()[0] == 2


def test_a_failed_file_can_later_be_imported(conn):
    # Fix the parser, restart, succeed — the partial index must not treat the
    # earlier failure as a conflict.
    sha = a_hash()
    with conn.cursor() as cur:
        cur.execute(INSERT, ("paystubs", "march.pdf", sha, "failed", "no pay date"))
        cur.execute(INSERT, ("paystubs", "march.pdf", sha, "imported", None))


# ── the CHECK constraints ─────────────────────────────────────────────────


def test_a_failure_must_explain_itself(conn):
    with pytest.raises(psycopg2.errors.CheckViolation):
        with conn.cursor() as cur:
            cur.execute(INSERT, ("paystubs", "broken.pdf", a_hash(), "failed", None))


def test_a_success_must_not_carry_an_error(conn):
    with pytest.raises(psycopg2.errors.CheckViolation):
        with conn.cursor() as cur:
            cur.execute(INSERT, ("paystubs", "march.pdf", a_hash(), "imported", "huh"))


def test_status_vocabulary_is_closed(conn):
    with pytest.raises(psycopg2.errors.CheckViolation):
        with conn.cursor() as cur:
            cur.execute(INSERT, ("paystubs", "march.pdf", a_hash(), "pending", None))


# ── the helpers in poll.py, against real SQL ──────────────────────────────


def test_lookup_import_returns_nothing_for_unseen_content(conn):
    assert poll.lookup_import(conn, a_hash()) is None


def test_lookup_import_returns_the_newest_row(conn):
    sha = a_hash()
    with conn.cursor() as cur:
        cur.execute(INSERT, ("paystubs", "march.pdf", sha, "failed", "no pay date"))
        cur.execute(INSERT, ("paystubs", "march.pdf", sha, "imported", None))
    # Newest-first matters: taking any row would leave a file that has since
    # been imported looking permanently quarantined.
    assert poll.lookup_import(conn, sha) == ("imported", None)


def test_record_success_leaves_the_transaction_open(conn):
    sha = a_hash()
    poll.record_success(conn, "paystubs", "march.pdf", sha, 12)
    conn.rollback()
    # Rolled away with the parser's work, which is the point: the log row and
    # the transactions it describes commit together or not at all.
    assert poll.lookup_import(conn, sha) is None


def test_record_success_stores_the_row_count(conn):
    sha = a_hash()
    poll.record_success(conn, "paystubs", "march.pdf", sha, 12)
    with conn.cursor() as cur:
        cur.execute("SELECT status, row_count FROM import_log WHERE sha256 = %s", (sha,))
        assert cur.fetchone() == ("imported", 12)


def test_record_failure_truncates_a_huge_error(conn):
    sha = a_hash()
    poll.record_failure(conn, "paystubs", "broken.pdf", sha, "x" * 99_999)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT length(error_text) FROM import_log WHERE sha256 = %s", (sha,))
            assert cur.fetchone()[0] == poll.ERROR_TEXT_LIMIT
    finally:
        _cleanup(sha)


def test_record_failure_commits(conn):
    # It has to: the caller has just rolled the parser's work back, so the
    # quarantine record is alone in its transaction and nothing else will
    # commit it. Proven from a second connection rather than from this one.
    sha = a_hash()
    poll.record_failure(conn, "paystubs", "broken.pdf", sha, "ValueError: no pay date")
    try:
        other = psycopg2.connect(IMPORTER_URL)
        try:
            assert poll.lookup_import(other, sha) == ("failed", "ValueError: no pay date")
        finally:
            other.close()
    finally:
        _cleanup(sha)


def _cleanup(sha):
    """Remove a committed test row. finance_importer cannot DELETE, by design."""
    if not ADMIN_URL:
        return
    admin = psycopg2.connect(ADMIN_URL)
    try:
        admin.autocommit = True
        with admin.cursor() as cur:
            cur.execute("DELETE FROM import_log WHERE sha256 = %s", (sha,))
    finally:
        admin.close()


# ── the append-only guarantee, from the importer's own credentials ────────


def test_importer_cannot_rewrite_its_history(conn):
    sha = a_hash()
    with conn.cursor() as cur:
        cur.execute(INSERT, ("paystubs", "broken.pdf", sha, "failed", "no pay date"))
    for statement in (
        "UPDATE import_log SET status = 'imported' WHERE sha256 = %s",
        "DELETE FROM import_log WHERE sha256 = %s",
    ):
        conn.rollback()
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            with conn.cursor() as cur:
                cur.execute(statement, (sha,))
