# Importer

Covers the importer service and adding new import types.

## Overview

The `importer` service automates file-to-transaction ingestion. It polls subdirectories under `imports/` every 60 seconds, routing each file to a matching parser module in `importer/parsers/`. Each line item is mapped to primary keys in the database (`accounts`, `transaction_categories`, `transaction_category_types`) and inserted as transaction rows.

Unmatched fields are still a hard failure for the file they occur in — there are no silent skips, and a file is never partially imported. They are no longer a hard failure for the *service*: the file is quarantined, and the poller moves on to the next one. See [When a file fails](#when-a-file-fails).

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

## Idempotency

Every file is hashed (sha256) before it is parsed, and the result is recorded in the `import_log` table. If those exact bytes already carry an `imported` row, the file is skipped and the parser is never called.

This means **re-dropping a file is a no-op**, under any name. Nothing is ever moved or deleted from `imports/` — the importer only ever reads it — so successfully imported files simply stay where you put them, and a file copied twice imports once.

Two details worth knowing:

- **Dedup is on content, not filename.** Renaming a file does not make it import again; editing it does, because the bytes change.
- **The guarantee lives in the database, not in the poller.** A partial unique index on `(sha256) WHERE status = 'imported'` makes a second successful import of identical bytes impossible even if two pollers raced. The lookup in `poll.py` is an optimisation on top of it.

Parsers therefore no longer need duplicate guards of their own. A parser that still carries one is harmless, just redundant.

### The first poll after upgrading

`import_log` starts empty, so files **already sitting in `imports/`** from before this change have no row saying they were imported — and the first sweep hands every one of them to its parser again. Nothing in the table can say otherwise, because nothing was recording anything until now.

In practice this is absorbed by exactly the duplicate guards described above: the pre-existing parsers carry them, so the re-parse inserts nothing and is recorded as an import of zero rows. But if you have written a parser **without** a guard, empty its drop folder before the first poll, or accept the duplicate. Every poll after that one is protected by the hash.

## When a file fails

A parser exception quarantines that one file and the loop continues. The container is not restarted, and every other pending file still imports.

The quarantine is a row in `import_log` with `status = 'failed'` and the error text — **not** a `.failed/` directory. The file stays exactly where it is. To see what is currently stuck:

```sql
SELECT imported_at, import_type, file_name, error_text
FROM import_log
WHERE status = 'failed'
ORDER BY imported_at DESC
LIMIT 20;
```

The full traceback is in the container log (`docker compose logs importer`); `error_text` holds the first 4000 characters of the exception.

**To retry a quarantined file**, do either of:

- **Fix the file.** Its hash changes, so the next poll treats it as new. No other step needed.
- **Fix the parser, then restart the importer.** The first sweep after a restart retries everything currently quarantined, on the assumption that a restart is what a parser change looks like. Later sweeps leave it alone, so a permanently bad file is not re-parsed every 60 seconds forever.

Because `import_log` is append-only, a file that failed and then succeeded keeps both rows — the newest row is the one that describes where it stands.

**A dropped database connection is not a parser failure** and quarantines nothing. The poller abandons the cycle, reconnects with exponential backoff (from `POLL_INTERVAL`, doubling to a 15-minute ceiling), and picks up where it left off. This distinction is why a Postgres restart no longer poisons the whole drop folder.

## Adding a New Import Type

1. Create a subdirectory under `imports/` (e.g., `imports/bank-statements/`)
2. Create a matching parser at `importer/parsers/bank_statements.py` (hyphens become underscores)
3. The parser module must expose a `process(filepath, conn, lookup_maps)` function
4. Drop files into the subdirectory — the importer picks them up on the next poll

Subdirectories without a matching parser are skipped with a warning.

### The parser contract

- **Do not commit or roll back.** The dispatcher owns the transaction boundary. It commits your inserts and the `import_log` row together, so they land or fail as one.
- **Raise on anything you cannot map.** That is what puts the file in quarantine with a useful message. Returning quietly records a successful import of nothing.
- **Optionally return the number of rows inserted.** If `process()` returns an `int` it is stored in `import_log.row_count`; anything else (including `None`, the default) records an unknown count. This is an optional return, so existing parsers need no change.

## Tests

`importer/tests/` covers the dispatch loop. It runs in CI and locally:

```sh
pip install -r importer/requirements-dev.txt
cd importer && pytest tests
```

The unit tests need nothing. The `import_log` integration tests are skipped unless `IMPORTER_DATABASE_URL` is set — see [testing.md](testing.md#importer-tests).
