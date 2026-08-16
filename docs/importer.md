# Importer

Covers the importer service and adding new import types.

## Overview

The `importer` service automates file-to-transaction ingestion. It polls subdirectories under `imports/` every 60 seconds, routing each file to a matching parser module in `importer/parsers/`. Each line item is mapped to primary keys in the database (`accounts`, `transaction_categories`, `transaction_category_types`) and inserted as transaction rows. Unmatched fields cause a hard failure — no silent skips.

The `importer/poll.py` dispatcher is committed to the repo. The `importer/parsers/` directory and `imports/` drop folder are gitignored — parser logic is user-specific since the field mapping depends on how you categorize your transactions.

## The image

The service runs from `finance-importer`, built from [`importer/Dockerfile`](../importer/Dockerfile) (Issue #224). `poll.py` and the pinned dependencies are baked in; it runs as a non-root user and installs nothing at container start.

What that leaves as a mount is only what cannot be baked:

| Path | Source | Why it is a mount |
| --- | --- | --- |
| `/input` | `./imports` | user documents |
| `/app/parsers` | `./importer/parsers` | gitignored and user-specific |

`parsers/` is deliberately excluded from the build context by [`importer/.dockerignore`](../importer/.dockerignore), so your parsers never enter the image or the build cache. Because `poll.py` is now baked rather than mounted, **editing it takes effect only after a rebuild**:

```sh
docker compose build importer && docker compose up -d importer
```

## Python dependencies

Runtime dependencies live in [`importer/requirements.txt`](../importer/requirements.txt), pinned to exact versions and installed at **build** time.

To add a dependency: add the pinned line to `requirements.txt`, then rebuild with the command above — `--force-recreate` alone no longer picks it up, because there is no longer a runtime `pip install` to re-run. Do **not** call `pip install` from inside a parser: the install is centralized so the dependency set is reproducible and so Dependabot's `pip` ecosystem can track it (see [CONTRIBUTING.md](../CONTRIBUTING.md#dependabot-prs)).

`pdfplumber` is pinned here even though its only consumer (the paystub parser) lives in the gitignored `importer/parsers/`, so the image has it ready without a parser having to self-install at import time.

## Adding a New Import Type

1. Create a subdirectory under `imports/` (e.g., `imports/bank-statements/`)
2. Create a matching parser at `importer/parsers/bank_statements.py` (hyphens become underscores)
3. The parser module must expose a `process(filepath, conn, lookup_maps)` function
4. Drop files into the subdirectory — the importer picks them up on the next poll

Subdirectories without a matching parser are skipped with a warning.
