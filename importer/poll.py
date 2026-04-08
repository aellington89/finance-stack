"""
Importer — polls subdirectories under /input for new files and routes
each one to a matching parser module in /app/parsers/.

To add a new import type:
  1. Create a subdirectory under imports/ (e.g., imports/bank-statements/)
  2. Create a matching parser at importer/parsers/bank_statements.py
     (directory name with hyphens converted to underscores)
  3. The parser module must expose a process(filepath, conn, lookup_maps) function

Subdirectories without a matching parser are skipped with a warning.
Unmatched fields during parsing cause a hard failure — no silent skips.
"""

import importlib
import os
import sys
import time
import psycopg2

INPUT_DIR = "/input"
PARSERS_DIR = "/app/parsers"
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", 60))
DATABASE_URL = os.environ["DATABASE_URL"]


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


def poll():
    print("Connecting to database...", flush=True)
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    print("Connected. Loading lookup maps...", flush=True)

    lookup_maps = load_lookup_maps(conn)
    print(
        f"Loaded {sum(len(v) for v in lookup_maps.values())} reference rows "
        f"across {len(lookup_maps)} tables.",
        flush=True,
    )

    print(f"Polling {INPUT_DIR} subdirectories every {POLL_INTERVAL}s...", flush=True)
    while True:
        for entry in sorted(os.listdir(INPUT_DIR)):
            subdir = os.path.join(INPUT_DIR, entry)
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
                filepath = os.path.join(subdir, filename)
                print(f"[{entry}] Processing: {filename}", flush=True)
                try:
                    parser.process(filepath, conn, lookup_maps)
                    conn.commit()
                    print(f"[{entry}] Imported: {filename}", flush=True)
                except Exception as e:
                    # Fail loudly — halt on unmatched fields or any other error
                    print(
                        f"FATAL [{entry}] {filename}: {e}",
                        file=sys.stderr,
                        flush=True,
                    )
                    conn.rollback()
                    sys.exit(1)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    poll()
