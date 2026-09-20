"""
Integration tests for the lookup maps against a real database (issue #273).

test_lookups.py covers resolution against hand-built maps. These cover the half
that only a live database can: that load_lookup_maps() names the columns that
actually exist, and that the reference rows in `Finances_Test` are resolvable by
name at all.

That second property is the closest thing this repository can have to a gate on
the importer's coupling. The parser that depends on those rows lives in
gitignored `importer/parsers/`, so no CI assertion can see which names it wants
— but every name-resolving parser needs the same thing from the database, and
that *is* checkable: no two reference rows may share a name, or neither can be
resolved. Nothing enforces it in the schema, because none of these name columns
carries a UNIQUE constraint.

Skipped unless IMPORTER_DATABASE_URL is set. CI sets it in the `ci` job, after
the migrations, the shared seed and the test fixture have all been applied.
"""

import os

import psycopg2
import pytest

import lookups
import poll

IMPORTER_URL = os.environ.get("IMPORTER_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not IMPORTER_URL, reason="IMPORTER_DATABASE_URL is not set"
)


@pytest.fixture
def conn():
    """A finance_importer connection whose reads are rolled back after each test."""
    connection = psycopg2.connect(IMPORTER_URL)
    connection.autocommit = False
    yield connection
    connection.rollback()
    connection.close()


@pytest.fixture
def maps(conn):
    return poll.load_lookup_maps(conn)


def rows(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


# ── the maps match the schema ─────────────────────────────────────────────


def test_every_map_is_populated(maps):
    # A typo in a column name would come back as an empty map rather than an
    # error, and every resolution would then fail identically.
    for key in (
        "accounts",
        "account_identifiers",
        "transaction_categories",
        "transaction_category_types",
    ):
        assert maps[key], f"{key} is empty"


def test_the_metadata_keys_are_present_and_are_not_tables(maps):
    assert lookups.AMBIGUOUS in maps
    assert lookups.CLOSED_ACCOUNTS in maps
    # lookup_summary counts tables only, so the metadata must not inflate it.
    tables = [k for k in maps if not k.startswith("_")]
    assert len(tables) == 4, tables


def test_the_account_name_map_covers_every_account(conn, maps):
    # Equal counts prove nothing was lost on the way into the dict — which,
    # given there is no UNIQUE constraint on account_name, is a real risk.
    (total,) = rows(conn, "SELECT count(*) FROM accounts")[0]

    assert len(maps["accounts"]) == total


def test_the_identifier_map_covers_every_account_that_has_one(conn, maps):
    (expected,) = rows(
        conn,
        "SELECT count(DISTINCT account_identifier) FROM accounts "
        "WHERE account_identifier IS NOT NULL",
    )[0]

    assert len(maps["account_identifiers"]) == expected


def test_closed_accounts_match_the_table(conn, maps):
    expected = {
        row[0]
        for row in rows(
            conn, "SELECT account_id FROM accounts WHERE closed_date IS NOT NULL"
        )
    }

    assert maps[lookups.CLOSED_ACCOUNTS] == expected


# ── the reference rows are resolvable by name ─────────────────────────────


@pytest.mark.parametrize(
    "table,name_column",
    [
        ("accounts", "account_name"),
        ("transaction_categories", "transaction_category"),
        ("transaction_types", "transaction_type"),
    ],
)
def test_no_two_reference_rows_share_a_name(conn, table, name_column):
    # The property every name-resolving parser depends on, and that the schema
    # does not enforce. A duplicate here means that name resolves for nobody.
    duplicates = rows(
        conn,
        f"SELECT {name_column}, count(*) FROM {table} "
        f"GROUP BY 1 HAVING count(*) > 1 ORDER BY 1",
    )

    assert duplicates == [], f"{table}.{name_column} is not unique: {duplicates}"


def test_the_maps_carry_no_ambiguous_names(maps):
    # The same property, as load_lookup_maps() sees it. Stated twice on purpose:
    # the query above says the database is clean, this says the loader agrees.
    assert maps[lookups.AMBIGUOUS] == {}


@pytest.mark.parametrize(
    "map_key,table,id_column,name_column",
    [
        ("accounts", "accounts", "account_id", "account_name"),
        (
            "transaction_categories",
            "transaction_categories",
            "transaction_category_id",
            "transaction_category",
        ),
        (
            "transaction_category_types",
            "transaction_types",
            "transaction_type_id",
            "transaction_type",
        ),
    ],
)
def test_resolve_returns_the_id_the_database_holds(
    conn, maps, map_key, table, id_column, name_column
):
    # Round-tripped against the table rather than against a hardcoded id, so a
    # renamed fixture row does not turn this into a failure that means nothing.
    for row_id, name in rows(conn, f"SELECT {id_column}, {name_column} FROM {table}"):
        assert lookups.resolve(maps, map_key, name) == row_id


def test_resolve_account_by_last4_round_trips(conn, maps):
    # Only the identifiers whose last four digits are theirs alone — a collision
    # is supposed to raise, and the fixture is free to contain one.
    counts = {}
    for (identifier,) in rows(
        conn,
        "SELECT account_identifier FROM accounts WHERE account_identifier IS NOT NULL",
    ):
        counts[identifier[-4:]] = counts.get(identifier[-4:], 0) + 1

    unique = [
        (identifier, account_ids[0])
        for identifier, account_ids in maps["account_identifiers"].items()
        if counts[identifier[-4:]] == 1 and len(account_ids) == 1
    ]
    assert unique, "no account has a last-4 of its own"

    for identifier, account_id in unique:
        assert lookups.resolve_account_by_last4(maps, identifier[-4:]) == account_id


def test_a_name_no_row_carries_still_fails(maps):
    # Proving the live path fails as well as succeeds — the fail-loud half is the
    # whole point of resolving by name (#273).
    with pytest.raises(lookups.MappingError):
        lookups.resolve(maps, "transaction_categories", "No Such Category At All")
