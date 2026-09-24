"""
Unit tests for name-based lookup resolution (issue #273).

No database and no fakes: lookups.py is pure, taking the maps poll.py builds and
returning ids. That purity is the point — the parsers that call it live in
gitignored `importer/parsers/`, so they are absent from CI and cannot be tested
here at all. Resolution is the part of their behaviour that can be, which is why
it lives in tracked code.

The cases that matter are the ones that used to be silent: a name held by two
rows, and a masked account number whose last four digits match more than one
account. Both previously resolved to whichever row was read last.
"""

import pytest

import lookups
from lookups import MappingError


def maps(**overrides):
    """
    A lookup-maps dict shaped like load_lookup_maps() returns.

    Account 8 is closed and shares its last four digits with open account 1, so
    the replaced-card collision is available to every test without setup.
    """
    base = {
        "accounts": {
            "Epic Pay": 27,
            "Checking": 1,
            "Old Checking": 8,
        },
        # identifier -> every account carrying it. "1122223401" is one member
        # number shared by two accounts, which is the case that used to vanish.
        "account_identifiers": {
            "9012343401": (1,),
            "8877773401": (8,),
            "5550009999": (27,),
            "R-1234567": (6,),
            "1122223219": (11, 12),
        },
        "transaction_categories": {
            "Federal Income Tax": 23,
            "Medicare Tax": 22,
            "Labor Earnings": 15,
        },
        "transaction_category_types": {"Expense": 2, "Income": 4},
        lookups.CLOSED_ACCOUNTS: {8},
        lookups.AMBIGUOUS: {},
    }
    base.update(overrides)
    return base


# ── resolve ───────────────────────────────────────────────────────────────


def test_resolve_returns_the_id_for_a_name():
    assert lookups.resolve(maps(), "transaction_categories", "Medicare Tax") == 22


def test_resolve_names_the_missing_row_and_its_table():
    # The message is the whole value of failing loudly: it lands in
    # import_log.error_text, and it has to be enough to fix the problem without
    # reading the parser.
    with pytest.raises(MappingError) as caught:
        lookups.resolve(maps(), "transaction_categories", "Dental")

    message = str(caught.value)
    assert "transaction_categories" in message
    assert "'Dental'" in message


def test_resolve_names_what_needed_the_row():
    with pytest.raises(MappingError) as caught:
        lookups.resolve(
            maps(), "transaction_categories", "Dental", what="deduction 'Delta Dental'"
        )

    assert "deduction 'Delta Dental'" in str(caught.value)


def test_resolve_reports_the_real_table_behind_the_misnamed_key():
    # The map key is "transaction_category_types" but the table is
    # transaction_types. Someone reading the error goes looking in psql, so the
    # message must name the table that exists.
    with pytest.raises(MappingError) as caught:
        lookups.resolve(maps(), "transaction_category_types", "Dividend")

    assert "transaction_types" in str(caught.value)
    assert "transaction_category_types" not in str(caught.value)


def test_resolve_refuses_an_ambiguous_name():
    # transaction_category has no UNIQUE constraint, so two rows can share a
    # name and the name -> id dict keeps only one of them. Returning that one is
    # the same silent wrong answer as a reused primary key.
    ambiguous = maps(**{lookups.AMBIGUOUS: {"transaction_categories": {"Medicare Tax"}}})

    with pytest.raises(MappingError) as caught:
        lookups.resolve(ambiguous, "transaction_categories", "Medicare Tax")

    message = str(caught.value)
    assert "More than one" in message
    assert "'Medicare Tax'" in message
    # And it says what to do about it, since the fix is not obvious.
    assert "rename" in message.lower()


def test_resolve_still_serves_unambiguous_names_from_the_same_table():
    ambiguous = maps(**{lookups.AMBIGUOUS: {"transaction_categories": {"Medicare Tax"}}})
    assert lookups.resolve(ambiguous, "transaction_categories", "Labor Earnings") == 15


def test_resolve_raises_for_a_table_the_maps_do_not_carry():
    # A parser asking for a key that does not exist is a bug in the parser, but
    # it must arrive as a quarantine with a readable message rather than a
    # KeyError traceback.
    with pytest.raises(MappingError) as caught:
        lookups.resolve(maps(), "budget_categories", "Groceries")

    message = str(caught.value)
    assert "budget_categories" in message
    # The available tables are listed, and the metadata keys are not offered as
    # though they were tables.
    assert "transaction_categories" in message
    assert lookups.AMBIGUOUS not in message


def test_is_ambiguous_is_false_when_nothing_collides():
    assert not lookups.is_ambiguous(maps(), "transaction_categories", "Medicare Tax")


# ── resolve_all ───────────────────────────────────────────────────────────


def test_resolve_all_returns_every_id_keyed_by_table_and_name():
    resolved = lookups.resolve_all(
        maps(),
        {
            "transaction_categories": ("Medicare Tax", "Labor Earnings"),
            "accounts": ("Epic Pay",),
        },
    )

    assert resolved == {
        ("transaction_categories", "Medicare Tax"): 22,
        ("transaction_categories", "Labor Earnings"): 15,
        ("accounts", "Epic Pay"): 27,
    }


def test_resolve_all_reports_every_failure_at_once():
    # Raise-on-first would mean one re-drop of the document per missing row. A
    # stub with three unresolvable categories should name all three so one edit
    # fixes it.
    with pytest.raises(MappingError) as caught:
        lookups.resolve_all(
            maps(),
            {
                "transaction_categories": ("Dental", "Vision", "Medicare Tax"),
                "accounts": ("Payroll",),
            },
        )

    message = str(caught.value)
    assert "3 unresolvable lookup(s)" in message
    assert "'Dental'" in message
    assert "'Vision'" in message
    assert "'Payroll'" in message
    # The one that did resolve is not reported as a problem.
    assert "'Medicare Tax'" not in message


def test_resolve_all_accepts_an_empty_requirement_set():
    assert lookups.resolve_all(maps(), {}) == {}


# ── resolve_account_by_last4 ──────────────────────────────────────────────


def test_last4_resolves_a_single_match():
    assert lookups.resolve_account_by_last4(maps(), "9999") == 27


def test_last4_raises_when_nothing_matches():
    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(maps(), "1234")

    assert "'1234'" in str(caught.value)
    assert "account_identifier" in str(caught.value)


def test_last4_raises_on_a_collision_instead_of_picking_one():
    # The old implementation built {last4: account} and let the last row win, so
    # a distribution silently posted to whichever account was read last. This is
    # not hypothetical: a credit union storing one member number against the
    # checking, savings and HELOC rows makes all three collide permanently, and
    # six months of one real paystub series landed on the wrong one that way.
    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(maps(), "3401")

    message = str(caught.value)
    assert "2 accounts" in message
    assert "'Checking' (id 1)" in message
    assert "'Old Checking' (id 8)" in message


def test_last4_collision_says_how_to_disambiguate():
    # A collision the identifier cannot resolve is the caller's to break, so the
    # message has to say so — otherwise the only visible advice is "rename
    # something", which for a shared member number is not available.
    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(maps(), "3401")

    message = str(caught.value)
    assert "Disambiguate in the parser" in message
    assert "resolve()" in message


def test_last4_collision_marks_the_closed_account():
    # Which of the two is the replaced card is the first thing anyone will want
    # to know, and it decides which identifier to correct.
    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(maps(), "3401")

    assert "'Old Checking' (id 8) [closed]" in str(caught.value)
    assert "'Checking' (id 1) [closed]" not in str(caught.value)


def test_last4_matches_a_non_numeric_identifier_loudly():
    # 'R-1234567'[-4:] is '4567', which a real card can share. Nothing stops the
    # match, so it must be visible rather than clever.
    assert lookups.resolve_account_by_last4(maps(), "4567") == 6

    collides = maps(
        account_identifiers={"R-1234567": (6,), "4111222234567": (3,)},
    )
    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(collides, "4567")

    assert "2 accounts" in str(caught.value)


def test_last4_skips_accounts_with_no_identifier():
    # account_identifier is nullable, and load_lookup_maps leaves NULLs out.
    # Resolution must not treat an absent identifier as a match for anything.
    with pytest.raises(MappingError):
        lookups.resolve_account_by_last4(maps(account_identifiers={}), "3401")


def test_last4_raises_when_the_image_predates_the_identifier_map():
    # A stale image whose load_lookup_maps() has no account_identifiers key must
    # say so, since the fix is a rebuild rather than a database change.
    stale = maps()
    del stale["account_identifiers"]

    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(stale, "3401")

    assert "rebuild" in str(caught.value).lower()


def test_last4_names_what_needed_the_account():
    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(
            maps(), "1234", what="net pay distribution"
        )

    assert "net pay distribution" in str(caught.value)


def test_last4_sees_accounts_that_share_one_identifier():
    # The bug this shape exists to prevent. A credit union stores one member
    # number against checking, savings and loan alike, so {identifier: id} would
    # keep one of them and resolve the last-4 to whichever it kept — silently,
    # and wrongly, which is exactly what happened for six months of real
    # distributions before #273.
    with pytest.raises(MappingError) as caught:
        lookups.resolve_account_by_last4(maps(), "3219")

    message = str(caught.value)
    assert "2 accounts" in message
