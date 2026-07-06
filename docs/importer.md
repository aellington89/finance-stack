# Importer

Covers the importer service and adding new import types.

## Overview

The `importer` service automates file-to-transaction ingestion. It polls subdirectories under `imports/` every 60 seconds, routing each file to a matching parser module in `importer/parsers/`. Each line item is mapped to primary keys in the database (`accounts`, `transaction_categories`, `transaction_category_types`) and inserted as transaction rows. Unmatched fields cause a hard failure — no silent skips.

The `importer/poll.py` dispatcher is committed to the repo. The `importer/parsers/` directory and `imports/` drop folder are gitignored — parser logic is user-specific since the field mapping depends on how you categorize your transactions.

## Adding a New Import Type

1. Create a subdirectory under `imports/` (e.g., `imports/bank-statements/`)
2. Create a matching parser at `importer/parsers/bank_statements.py` (hyphens become underscores)
3. The parser module must expose a `process(filepath, conn, lookup_maps)` function
4. Drop files into the subdirectory — the importer picks them up on the next poll

Subdirectories without a matching parser are skipped with a warning.
