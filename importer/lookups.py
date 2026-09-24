"""
Name-based lookup resolution for importer parsers (issue #273).

Parsers used to resolve a field to a primary key by writing the integer in.
`importer/parsers/paystubs.py` pinned seventeen of them, twelve being
`transaction_categories` rows the user can rename or delete from
`/settings/categories`. Deleting one made the next import fail on a foreign key,
which is at least loud. Deleting it and letting the id be **reused** was the bad
case: federal income tax filed under whatever category now occupied 23, with
nothing raised anywhere. The seed-data taxonomy in docs/database.md calls code
depending on a specific user-owned row the one combination that is a defect
rather than a category, and this was its second, undocumented instance.

`poll.py` already builds name -> id maps and hands them to every parser, so the
resolution belongs here rather than in each parser's constants block.

This module is deliberately pure — it takes the maps and returns ids, touching
no connection and no filesystem. That matters more than usual here:
`importer/parsers/` is gitignored, so the parsers calling this are absent from
CI and from every gate in this repository. Putting the resolution in tracked
code is the only way any of it gets tested.

Everything raises MappingError, and every message names the row that is missing
so the quarantine text alone is enough to fix it.
"""


class MappingError(Exception):
    """
    Raised when a field cannot be resolved to a primary key.

    Lives here rather than in a parser so the dispatcher can tell a lookup miss
    apart from an unparseable document and reload the maps before giving up —
    see poll.py. Parsers that defined their own MappingError should import this
    one instead; `except MappingError` sites need no other change.
    """


# Reserved keys in the maps dict. load_lookup_maps() stores dispatcher metadata
# under names starting with an underscore and lookup tables under everything
# else, so a parser walking the maps can skip these by prefix.
AMBIGUOUS = "_ambiguous"
CLOSED_ACCOUNTS = "_closed_accounts"

# The map key for transaction_types is "transaction_category_types" — a misnomer
# kept because parsers this repository cannot see are already reading it (see
# load_lookup_maps). Messages name the real table, so a missing row can be found
# in psql without knowing about the misnomer.
TABLE_NAMES = {
    "accounts": "accounts",
    "account_identifiers": "accounts.account_identifier",
    "transaction_categories": "transaction_categories",
    "transaction_category_types": "transaction_types",
}


def _table_name(table_key):
    """The real table name for a map key, for use in an error message."""
    return TABLE_NAMES.get(table_key, table_key)


def _for(what):
    """`what` as a trailing clause, or nothing when the caller gave no context."""
    return f" (needed for {what})" if what else ""


def _missing(table_key, name, what):
    return f"No {_table_name(table_key)} row named '{name}'{_for(what)}"


def _ambiguous(table_key, name, what):
    return (
        f"More than one {_table_name(table_key)} row is named '{name}'"
        f"{_for(what)} — rename one so it can be resolved by name"
    )


def is_ambiguous(maps, table_key, name):
    """Whether `name` is carried by more than one row of that table."""
    return name in maps.get(AMBIGUOUS, {}).get(table_key, ())


def resolve(maps, table_key, name, *, what=None):
    """
    The primary key for `name` in `maps[table_key]`.

    `what` names the thing that needed it — a PDF label, a column — so the
    quarantine text says which line of which document cannot be imported rather
    than only which row is absent.

    Raises MappingError when the name is absent, and also when it is
    **ambiguous**: none of `accounts.account_name`,
    `transaction_categories.transaction_category` or
    `transaction_types.transaction_type` carries a UNIQUE constraint, so two
    rows can share a name and a name -> id dict keeps only whichever Postgres
    read last. Silently resolving to that one would be the same wrong answer
    this module exists to remove.
    """
    table = maps.get(table_key)
    if table is None:
        raise MappingError(
            f"The dispatcher's lookup maps carry no '{table_key}'{_for(what)} — "
            f"available: {', '.join(sorted(k for k in maps if not k.startswith('_')))}"
        )

    if is_ambiguous(maps, table_key, name):
        raise MappingError(_ambiguous(table_key, name, what))

    try:
        return table[name]
    except KeyError:
        raise MappingError(_missing(table_key, name, what)) from None


def resolve_all(maps, requirements):
    """
    Resolve every name in `requirements`, or raise once listing every failure.

    `requirements` maps a table key to the names wanted from it:

        {"transaction_categories": ("Federal Income Tax", "Medicare Tax")}

    Returns {(table_key, name): id}.

    Accumulate-then-raise rather than raise-on-first, matching how a parser
    reports unmapped document fields: a stub with five unresolvable categories
    should name all five, so one edit fixes the file instead of five rounds of
    re-dropping it. This is also what the dispatcher calls to preflight a
    parser's declared REQUIRED_LOOKUPS before it opens a single document.
    """
    resolved = {}
    errors = []

    for table_key, names in requirements.items():
        for name in names:
            try:
                resolved[(table_key, name)] = resolve(maps, table_key, name)
            except MappingError as exc:
                errors.append(str(exc))

    if errors:
        raise MappingError(
            f"{len(errors)} unresolvable lookup(s):\n"
            + "\n".join(f"  - {e}" for e in errors)
        )

    return resolved


def _account_label(maps, account_id):
    """`'Name' (id N)`, marked when the account is closed."""
    names = {aid: name for name, aid in maps.get("accounts", {}).items()}
    label = f"'{names.get(account_id, '?')}' (id {account_id})"
    if account_id in maps.get(CLOSED_ACCOUNTS, ()):
        label += " [closed]"
    return label


def resolve_account_by_last4(maps, last4, *, what=None):
    """
    The account whose `account_identifier` ends in `last4`.

    Paystubs mask the destination of a net-pay distribution as `xxxxxx3401`, so
    the last four digits are all there is to match on. `account_identifier` is
    nullable and carries no UNIQUE constraint, and the last four characters of
    two different identifiers collide easily — a replaced card keeps the old
    account around, and a non-numeric identifier like 'R-1234567' ends in
    '4567', which a real card can share.

    So a collision raises, naming every candidate and marking the closed ones,
    rather than being resolved by a rule. The previous implementation built a
    dict keyed on the last four and let the last row win, which silently posted
    a distribution to whichever account happened to be read last.
    """
    identifiers = maps.get("account_identifiers")
    if identifiers is None:
        raise MappingError(
            f"The dispatcher's lookup maps carry no 'account_identifiers'"
            f"{_for(what)} — rebuild the importer image so load_lookup_maps() "
            f"includes it"
        )

    # Each value is every account carrying that identifier, so accounts sharing
    # one member number all reach the candidate set and the collision is seen.
    candidates = {
        account_id
        for identifier, account_ids in identifiers.items()
        if identifier[-4:] == last4
        for account_id in account_ids
    }

    if not candidates:
        raise MappingError(
            f"No account has an account_identifier ending in '{last4}'"
            f"{_for(what)}"
        )

    if len(candidates) > 1:
        listed = ", ".join(
            _account_label(maps, account_id) for account_id in sorted(candidates)
        )
        raise MappingError(
            f"{len(candidates)} accounts have an account_identifier ending in "
            f"'{last4}'{_for(what)}: {listed} — the last four digits cannot "
            f"identify one of them. This is routine where a credit union stores "
            f"one member number against every account, in which case no number "
            f"on the document can tell them apart. Disambiguate in the parser on "
            f"something the document also carries — the account type beside the "
            f"masked number, say — and resolve by name with resolve()."
        )

    return candidates.pop()
