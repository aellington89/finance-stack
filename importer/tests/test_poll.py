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

import lookups
import poll
from conftest import FakeConn, FakeParser, lookup_query_results


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


def run_sweep(monkeypatch, parser, input_dir, conn, retry_failed=False, lookup_maps=None):
    monkeypatch.setattr(poll, "load_parser", lambda import_type: parser)
    return poll.poll_once(
        conn,
        {} if lookup_maps is None else lookup_maps,
        input_dir,
        retry_failed=retry_failed,
    )


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
        "account_identifiers",
        "transaction_categories",
        # The table is transaction_types; the key is a misnomer that stays one,
        # because parsers this repository cannot see already read it (#273).
        "transaction_category_types",
        lookups.CLOSED_ACCOUNTS,
        lookups.AMBIGUOUS,
    }
    assert conn.verbs[-1] == "rollback", conn.verbs


# ── the lookup maps ───────────────────────────────────────────────────────


def maps_from(accounts=(), categories=(), types=()):
    """load_lookup_maps() against one set of rows, using the fake cursor queue."""
    conn = FakeConn(
        fetchall_results=lookup_query_results(accounts, categories, types)
    )
    return poll.load_lookup_maps(conn)


def test_lookup_maps_key_names_by_id():
    maps = maps_from(
        accounts=[(27, "Epic Pay", "5550001111", None)],
        categories=[(23, "Federal Income Tax")],
        types=[(2, "Expense")],
    )

    assert maps["accounts"] == {"Epic Pay": 27}
    assert maps["transaction_categories"] == {"Federal Income Tax": 23}
    assert maps["transaction_category_types"] == {"Expense": 2}


def test_lookup_maps_expose_account_identifiers():
    # The one thing these maps could not do, and the whole stated reason
    # paystubs.py discarded them and hardcoded twelve category ids (#273).
    maps = maps_from(accounts=[(27, "Epic Pay", "5550001111", None)])

    # Values are tuples, not bare ids: an identifier is not unique.
    assert maps["account_identifiers"] == {"5550001111": (27,)}


def test_lookup_maps_omit_null_identifiers():
    # account_identifier is nullable. A NULL must not become a key, or every
    # last-4 lookup would have a phantom candidate.
    maps = maps_from(
        accounts=[(1, "Checking", "9012343401", None), (2, "Cash", None, None)]
    )

    assert maps["account_identifiers"] == {"9012343401": (1,)}
    assert maps["accounts"] == {"Checking": 1, "Cash": 2}


def test_lookup_maps_keep_every_account_sharing_one_identifier():
    # The collapse that hid a real misfiling for six months. One credit-union
    # member number covers checking, savings and the HELOC, so a bare
    # {identifier: id} map would keep one and resolve the last-4 to it silently.
    maps = maps_from(
        accounts=[
            (1, "UWCU Checking", "9012343401", None),
            (2, "UWCU Savings", "9012343401", None),
            (3, "UWCU HELOC", "9012343401", None),
        ]
    )

    assert maps["account_identifiers"] == {"9012343401": (1, 2, 3)}
    # And resolution refuses rather than picking one.
    with pytest.raises(lookups.MappingError) as caught:
        lookups.resolve_account_by_last4(maps, "3401")
    assert "3 accounts" in str(caught.value)


def test_lookup_maps_record_which_accounts_are_closed():
    maps = maps_from(
        accounts=[
            (1, "Checking", "9012343401", None),
            (8, "Old Checking", "8877773401", "2026-01-31"),
        ]
    )

    assert maps[lookups.CLOSED_ACCOUNTS] == {8}


def test_lookup_maps_record_a_name_held_by_two_rows():
    # transaction_category has no UNIQUE constraint, so the name -> id dict keeps
    # only one of them. Recording the collision is what lets resolution refuse
    # the name instead of silently returning whichever row was read last.
    maps = maps_from(
        categories=[(22, "Medicare Tax"), (99, "Medicare Tax"), (23, "Federal")]
    )

    assert maps[lookups.AMBIGUOUS] == {"transaction_categories": {"Medicare Tax"}}
    assert lookups.is_ambiguous(maps, "transaction_categories", "Medicare Tax")
    assert not lookups.is_ambiguous(maps, "transaction_categories", "Federal")


def test_lookup_maps_warn_about_an_ambiguous_name(capsys):
    # It is not an error on its own — nothing may resolve that name — but it is
    # invisible in the data, so it has to be said out loud at load time.
    maps_from(categories=[(22, "Medicare Tax"), (99, "Medicare Tax")])

    out = capsys.readouterr().out
    assert "'Medicare Tax'" in out
    assert "transaction_categories" in out


def test_lookup_maps_are_quiet_when_no_name_collides(capsys):
    maps_from(categories=[(22, "Medicare Tax"), (23, "Federal")])
    assert capsys.readouterr().out == ""


def test_lookup_summary_counts_tables_only():
    # The metadata keys are not tables, and counting them reports a row total
    # that reconciles against nothing in the database.
    maps = maps_from(
        accounts=[(1, "Checking", "9012343401", None)],
        categories=[(23, "Federal")],
        types=[(2, "Expense")],
    )

    summary = poll.lookup_summary(maps)
    # accounts 1 + account_identifiers 1 + categories 1 + types 1
    assert summary == "4 reference rows across 4 tables"


def test_reload_lookup_maps_refreshes_in_place():
    # poll() and any parser already hold this dict, so a reload that rebinds a
    # local would leave both looking at the stale copy.
    maps = maps_from(categories=[(23, "Federal")])
    original = maps
    conn = FakeConn(
        fetchall_results=lookup_query_results(categories=[(23, "Federal"), (24, "Food")])
    )

    poll.reload_lookup_maps(conn, maps)

    assert maps is original
    assert maps["transaction_categories"] == {"Federal": 23, "Food": 24}


# ── the lookup preflight (#273) ───────────────────────────────────────────


def paystub_maps(categories=(("23", 23),)):
    """Minimal maps carrying the named categories."""
    return {
        "accounts": {"Epic Pay": 27},
        "account_identifiers": {"5550001111": 27},
        "transaction_categories": dict(categories),
        "transaction_category_types": {"Expense": 2},
        lookups.CLOSED_ACCOUNTS: set(),
        lookups.AMBIGUOUS: {},
    }


def test_a_parser_declaring_nothing_is_not_preflighted(monkeypatch, drop_folder):
    # REQUIRED_LOOKUPS is optional, like the process() return value: parsers this
    # repository cannot see must keep working untouched.
    parser = FakeParser()
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(monkeypatch, parser, drop_folder("march.pdf"), conn)

    assert stats == {"imported": 1, "skipped": 0, "failed": 0}
    assert not hasattr(parser, "REQUIRED_LOOKUPS")


def test_declared_lookups_that_resolve_let_the_import_run(monkeypatch, drop_folder):
    parser = FakeParser(
        required_lookups={"transaction_categories": ("Federal Income Tax",)}
    )
    conn = FakeConn(fetchone_result=None)
    stats = run_sweep(
        monkeypatch,
        parser,
        drop_folder("march.pdf"),
        conn,
        lookup_maps=paystub_maps({"Federal Income Tax": 23}.items()),
    )

    assert stats == {"imported": 1, "skipped": 0, "failed": 0}
    assert parser.seen == ["march.pdf"]


def test_a_missing_declared_row_skips_the_type_without_opening_a_file(
    monkeypatch, drop_folder, capsys
):
    # The gate this coupling cannot have in CI, because the parser is gitignored:
    # the dispatcher proves the rows exist against the live database instead.
    parser = FakeParser(
        required_lookups={"transaction_categories": ("Federal Income Tax",)}
    )
    conn = FakeConn(fetchone_result=None)
    monkeypatch.setattr(poll, "load_lookup_maps", lambda c: paystub_maps())

    stats = run_sweep(
        monkeypatch,
        parser,
        drop_folder("a.pdf", "b.pdf", "c.pdf"),
        conn,
        lookup_maps=paystub_maps(),
    )

    assert stats == {"imported": 0, "skipped": 3, "failed": 0}
    # Not opened, so not hashed and not parsed.
    assert parser.seen == []
    # And nothing recorded: a missing row is a configuration fault, not three
    # bad documents, so fixing it lifts this with no restart.
    assert "INSERT" not in conn.verbs, conn.verbs


def test_the_preflight_error_names_every_missing_row(
    monkeypatch, drop_folder, capsys
):
    # Naming one of four means four rounds of fixing and re-polling.
    parser = FakeParser(
        required_lookups={
            "transaction_categories": ("Delta Dental", "Delta Vision", "GHC HMO"),
            "accounts": ("Payroll",),
        }
    )
    conn = FakeConn(fetchone_result=None)
    monkeypatch.setattr(poll, "load_lookup_maps", lambda c: paystub_maps())

    run_sweep(
        monkeypatch, parser, drop_folder("a.pdf"), conn, lookup_maps=paystub_maps()
    )

    err = capsys.readouterr().err
    assert "4 unresolvable lookup(s)" in err
    for name in ("Delta Dental", "Delta Vision", "GHC HMO", "Payroll"):
        assert f"'{name}'" in err, err
    assert "skipping 1 file(s)" in err


def test_a_stale_map_is_reloaded_before_the_preflight_refuses(
    monkeypatch, drop_folder
):
    # The maps load once per connection, so a category created through the UI
    # minutes ago is not in them. A first miss proves nothing.
    parser = FakeParser(
        required_lookups={"transaction_categories": ("Federal Income Tax",)}
    )
    conn = FakeConn(fetchone_result=None)
    reloads = []

    def reload(c):
        reloads.append(c)
        return paystub_maps({"Federal Income Tax": 23}.items())

    monkeypatch.setattr(poll, "load_lookup_maps", reload)

    stats = run_sweep(
        monkeypatch,
        parser,
        drop_folder("march.pdf"),
        conn,
        lookup_maps=paystub_maps(),
    )

    assert stats == {"imported": 1, "skipped": 0, "failed": 0}
    assert len(reloads) == 1, "the reload must happen exactly once"


def test_the_maps_are_reloaded_at_most_once_per_sweep(monkeypatch, tmp_path):
    # If a row really is absent, every type misses on it. Re-reading three tables
    # per failure would turn one mistake into a query storm on a 60s timer.
    for subdir in ("paystubs", "bank-statements"):
        target = tmp_path / subdir
        target.mkdir()
        (target / "a.pdf").write_text(subdir)

    parser = FakeParser(
        required_lookups={"transaction_categories": ("Nowhere",)}
    )
    conn = FakeConn(fetchone_result=None)
    reloads = []
    monkeypatch.setattr(
        poll, "load_lookup_maps", lambda c: reloads.append(c) or paystub_maps()
    )

    stats = run_sweep(
        monkeypatch, parser, str(tmp_path), conn, lookup_maps=paystub_maps()
    )

    assert stats == {"imported": 0, "skipped": 2, "failed": 0}
    assert len(reloads) == 1, f"reloaded {len(reloads)} times"


# ── the per-file lookup retry (#273) ──────────────────────────────────────


def test_a_mapping_error_reloads_the_maps_and_retries_once(
    monkeypatch, drop_folder
):
    # A parser may resolve a name it did not declare. Same reasoning as the
    # preflight: a first miss may only mean the maps are older than the row.
    attempts = []

    class FlakyParser:
        def process(self, filepath, conn, lookup_maps):
            attempts.append(dict(lookup_maps).get("transaction_categories"))
            if len(attempts) == 1:
                raise lookups.MappingError("No transaction_categories row named 'Food'")
            return 3

    conn = FakeConn(fetchone_result=None)
    monkeypatch.setattr(
        poll, "load_lookup_maps", lambda c: paystub_maps({"Food": 24}.items())
    )

    stats = run_sweep(
        monkeypatch,
        FlakyParser(),
        drop_folder("march.pdf"),
        conn,
        lookup_maps=paystub_maps(),
    )

    assert stats == {"imported": 1, "skipped": 0, "failed": 0}
    assert len(attempts) == 2
    # The retry saw the refreshed maps, not the stale ones it failed against.
    assert "Food" in attempts[1]


def test_a_genuinely_missing_row_is_quarantined_after_one_retry(
    monkeypatch, drop_folder
):
    parser = FakeParser(
        behaviour={
            "march.pdf": lookups.MappingError(
                "No transaction_categories row named 'Delta Dental'"
            )
        }
    )
    conn = FakeConn(fetchone_result=None)
    monkeypatch.setattr(poll, "load_lookup_maps", lambda c: paystub_maps())

    stats = run_sweep(
        monkeypatch,
        parser,
        drop_folder("march.pdf"),
        conn,
        lookup_maps=paystub_maps(),
    )

    assert stats == {"imported": 0, "skipped": 0, "failed": 1}
    # Retried once, then quarantined — not retried forever.
    assert parser.seen == ["march.pdf", "march.pdf"]
    # And the quarantine row still lands only after the rollback.
    assert has_run(conn.verbs, ["rollback", "INSERT", "commit"]), conn.verbs


def test_a_non_mapping_failure_is_not_retried(monkeypatch, drop_folder):
    # An unparseable document does not get better by reloading reference data.
    parser = FakeParser(behaviour={"march.pdf": ValueError("Could not find Pay Date")})
    conn = FakeConn(fetchone_result=None)
    reloads = []
    monkeypatch.setattr(
        poll, "load_lookup_maps", lambda c: reloads.append(c) or paystub_maps()
    )

    stats = run_sweep(
        monkeypatch,
        parser,
        drop_folder("march.pdf"),
        conn,
        lookup_maps=paystub_maps(),
    )

    assert stats == {"imported": 0, "skipped": 0, "failed": 1}
    assert parser.seen == ["march.pdf"]
    assert reloads == []
