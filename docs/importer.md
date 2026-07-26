# Importer

Covers the importer service and adding new import types.

## Overview

The `importer` service automates file-to-transaction ingestion. It polls subdirectories under `imports/` every 60 seconds, routing each file to a matching parser module in `importer/parsers/`. Each line item is mapped to primary keys in the database (`accounts`, `transaction_categories`, `transaction_category_types`) and inserted as transaction rows. Unmatched fields cause a hard failure — no silent skips.

The `importer/poll.py` dispatcher is committed to the repo. The `importer/parsers/` directory and `imports/` drop folder are gitignored — parser logic is user-specific since the field mapping depends on how you categorize your transactions.

## Python dependencies

Runtime dependencies live in [`importer/requirements.txt`](../importer/requirements.txt), pinned to exact versions. The `importer` Compose service installs them on start (`pip install -r /app/requirements.txt`) — the container uses the stock `python:3.13-slim` image, so there is no Dockerfile to rebuild.

To add a dependency: add the pinned line to `requirements.txt`, then `docker compose up -d --force-recreate importer`. Do **not** call `pip install` from inside a parser — the install is centralized so the dependency set is reproducible and so Dependabot's `pip` ecosystem can track it (see [CONTRIBUTING.md](../CONTRIBUTING.md#dependabot-prs)).

`pdfplumber` is pinned here even though its only consumer (the paystub parser) lives in the gitignored `importer/parsers/`, so the container has it ready without a parser having to self-install at import time.

## Adding a New Import Type

1. Create a subdirectory under `imports/` (e.g., `imports/bank-statements/`)
2. Create a matching parser at `importer/parsers/bank_statements.py` (hyphens become underscores)
3. The parser module must expose a `process(filepath, conn, lookup_maps)` function
4. Drop files into the subdirectory — the importer picks them up on the next poll

Subdirectories without a matching parser are skipped with a warning.
