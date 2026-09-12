"""
Shared fixtures for the importer suite (issue #124).

`importer/` is not a package — poll.py runs as a top-level script inside the
image (`CMD ["python", "poll.py"]`) — so the suite puts its parent directory on
sys.path rather than importing through a package path that does not exist in
production.

The real parser (`importer/parsers/paystubs.py`) cannot be used as a fixture:
`importer/parsers/` is gitignored and user-specific, so it is absent in CI and
on any fresh clone. Everything here therefore runs against FakeParser.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class FakeCursor:
    """Records the verb of every statement so ordering can be asserted."""

    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def execute(self, sql, params=None):
        self.conn.calls.append(("execute", sql.strip().split()[0].upper()))
        self.conn.executed.append((sql, params))

    def fetchone(self):
        return self.conn.fetchone_result

    def fetchall(self):
        return self.conn.fetchall_result


class FakeConn:
    """
    A psycopg2 connection stand-in that records the sequence of calls made
    against it. The call log is what lets the suite assert that the rollback
    precedes the failure record rather than merely that both happened.
    """

    def __init__(self, fetchone_result=None, fetchall_result=None):
        self.closed = 0
        self.calls = []
        self.executed = []
        self.fetchone_result = fetchone_result
        self.fetchall_result = fetchall_result or []

    def note(self, label):
        """Record a non-SQL event so it can be ordered against the statements."""
        self.calls.append((label, None))

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.calls.append(("commit", None))

    def rollback(self):
        self.calls.append(("rollback", None))

    def close(self):
        self.closed = 1

    @property
    def verbs(self):
        """The call log flattened to a list of verbs, for order assertions."""
        return [name if arg is None else arg for name, arg in self.calls]


class FakeParser:
    """
    Stands in for a module in parsers/. `behaviour` maps a filename to either an
    exception instance to raise or the value process() should return.
    """

    def __init__(self, behaviour=None, default=None):
        self.behaviour = behaviour or {}
        self.default = default
        self.seen = []

    def process(self, filepath, conn, lookup_maps):
        name = os.path.basename(filepath)
        self.seen.append(name)
        outcome = self.behaviour.get(name, self.default)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


@pytest.fixture
def drop_folder(tmp_path):
    """
    Builds an /input stand-in and returns its path.

    Each file's content defaults to its own name, so distinct names hash
    distinctly — pass an explicit mapping when a test needs two names to share
    one sha256.
    """

    def _make(*names, subdir="paystubs", **contents):
        target = tmp_path / subdir
        target.mkdir(exist_ok=True)
        for name in names:
            (target / name).write_text(name)
        for name, body in contents.items():
            (target / name).write_text(body)
        return str(tmp_path)

    return _make
