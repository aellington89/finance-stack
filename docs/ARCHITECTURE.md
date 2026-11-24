# Architecture

How Finance Stack fits together: a PostgreSQL 18 server holding the data, a Next.js app and a Python
importer that write it, each as its own least-privilege role, and optional services for dashboards,
error tracking, and TLS, all run with Docker Compose. The guides go deep on each part; this page
shows how the parts connect and how data moves between them, and
[the decision records](decisions/README.md) say why the costly-to-reverse choices were made.

## Services and profiles

The services without a profile always run. The others run only when `COMPOSE_PROFILES` in `.env`
lists their profile ([deployment.md](deployment.md#services-and-profiles)).

```mermaid
flowchart LR
    user(["Browser"])
    caddy["caddy · edge<br/>TLS and the public entry point"]
    app["finance-app<br/>Next.js, as finance_app"]
    importer["importer<br/>Python poll loop, as finance_importer"]
    migrate["migrate · one-shot<br/>databases, roles, migrations,<br/>lookups, and grants"]
    backup["pg-backup<br/>pg_dump on an interval"]
    metabase["metabase · bi<br/>dashboards, read-only as finance_bi"]
    glitchtip["glitchtip · errors<br/>the app's server errors"]
    drop[("./imports/<br/>the drop folder")]
    dumps[("./backups/")]
    subgraph pg ["postgres 18"]
        fin[("Finances")]
        mbdb[("metabase")]
        gtdb[("glitchtip")]
    end

    user -- "HTTPS" --> caddy --> app
    user -. "127.0.0.1:3001" .-> app
    migrate -- "first, as the superuser" --> fin
    migrate -. "completes before" .-> app & importer
    app --> fin
    drop --> importer --> fin
    backup --> fin
    backup --> dumps
    metabase --> fin
    metabase --> mbdb
    app -. "ERROR_DSN" .-> glitchtip --> gtdb

    classDef store fill:#e3ecfd,stroke:#3b63c4,color:#0f1f4d
    classDef optional fill:#f3effa,stroke:#7a5cb8,color:#2b1a4d
    class drop,dumps,fin,mbdb,gtdb store
    class caddy,metabase,glitchtip optional
    style pg fill:#f7f7f8,stroke:#c9c9cf,color:#333333
```

| Service       | Profile             | Connects as                                            | Responsible for                                                                                                                                       |
| ------------- | ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres`    | always              |                                                        | `Finances`, plus the `metabase` and `glitchtip` databases for their profiles                                                                          |
| `migrate`     | always, then exits  | `POSTGRES_USER`, the superuser                         | Creates the databases and the service roles, applies the Drizzle migrations and the grants, and seeds the lookups (`app/scripts/migrate-and-seed.sh`) |
| `finance-app` | always              | `finance_app`                                          | The web app and its server actions: reads and writes the core tables, and only reads `users` and `audit_log`                                          |
| `importer`    | always              | `finance_importer`                                     | Imports the files dropped in `./imports/`, one parser per subdirectory; append-only on `transactions` ([importer.md](importer.md))                    |
| `pg-backup`   | always              | `POSTGRES_USER`                                        | Dumps each configured database to `./backups/` on an interval, and restores ([backups.md](backups.md))                                                |
| `metabase`    | `bi`                | `finance_bi` for the data, `metabase_user` for its own | Dashboards over the core tables and views, never `users` or `audit_log`                                                                               |
| `glitchtip`   | `errors`            | `glitchtip`                                            | Collects the app's server errors ([observability.md](observability.md#error-tracking))                                                                |
| `caddy`       | `edge`              |                                                        | Terminates TLS and forwards to `finance-app`                                                                                                          |
| `init-script` | `init`, run by hand | `POSTGRES_USER`                                        | Rebuilds the account balance history ([database.md](database.md))                                                                                     |

`scripts/verify-db-roles.sh` asserts the grant matrix behind the "Connects as" column in CI, and
fails on any login role it doesn't expect ([database.md](database.md)).

## An app request

Every page and server action is behind sign-in, and every write runs in an audited transaction, so
the audit log names who made each change without the app being able to write the log itself.

```mermaid
sequenceDiagram
    actor User
    participant Proxy as proxy.ts
    participant Auth as Auth.js
    participant Action as Page or server action
    participant Tx as auditedTransaction()
    participant DB as PostgreSQL, as finance_app
    participant Trigger as audit_row_change()

    User->>Proxy: Request
    Proxy->>Auth: Is there a valid session (JWT)?
    alt Not signed in
        Proxy-->>User: Redirect to /login
    else Signed in
        Proxy->>Action: Continue
        Action->>Auth: auth() again: the real boundary
        Action->>Action: Validate the input (lib/validations)
        Action->>Tx: The write
        Tx->>DB: BEGIN, then set_config: the actor's id and username, transaction-local
        Tx->>DB: Insert, update, or delete, through Drizzle
        DB->>Trigger: Row trigger
        Trigger->>DB: Insert into audit_log, with the owner's rights
        Tx->>DB: COMMIT
        Action-->>User: The revalidated page, or the field errors
    end
```

- **Signing in:** the Credentials provider checks the username and password hash in `users`, and
  issues a JWT session; there is no session table ([auth.md](auth.md)).
- **The audit log:** a `SECURITY DEFINER` trigger writes it, so the importer's inserts and anything
  done in `psql` are recorded too, and `finance_app` can only read it
  ([audit-log.md](audit-log.md)).
- **Errors:** server errors go to GlitchTip when `ERROR_DSN` is set, and to the structured log
  either way ([observability.md](observability.md)).

## Importing a file

The importer never moves or deletes a file: what it has done with each one is a row in `import_log`,
keyed on the file's content.

```mermaid
flowchart TB
    drop["A file lands in ./imports/TYPE/"] --> sweep["poll() sweeps every subdirectory"]
    sweep --> parser{{"A parser for TYPE<br/>in importer/parsers/?"}}
    parser -- "no" --> skip["Skipped, with a warning"]
    parser -- "yes" --> hash["Hash the bytes: sha256"]
    hash --> seen{{"Already imported<br/>in import_log?"}}
    seen -- "yes" --> noop["Skipped: the same bytes,<br/>under any name"]
    seen -- "no" --> run["parser.process(file, conn, lookups)<br/>inserts transactions"]
    run -- "succeeds" --> ok["import_log: imported,<br/>with the row count"]
    run -- "raises" --> bad["import_log: failed, with the error:<br/>quarantined until the bytes change<br/>or the importer restarts"]
    ok --> beat["Touch the heartbeat file,<br/>which the healthcheck reads"]
    bad --> beat

    classDef stop fill:#fdf0d5,stroke:#b7791f,color:#3d2a00
    classDef done fill:#e2f3e6,stroke:#2f7d43,color:#0f3d1a
    class skip,noop,bad stop
    class ok done
```

The parsers themselves are gitignored and mounted read-only, so CI tests the loop against a fake
parser. Each parser resolves every lookup by name, never by id ([importer.md](importer.md)).

## Backups and restores

```mermaid
flowchart LR
    timer(["Every BACKUP_INTERVAL_SECONDS"]) --> dump["pg-backup: pg_dump -Fc<br/>of each configured database"]
    upgrade(["deploy.sh, before an upgrade<br/>changes anything"]) --> pre["The backup gate:<br/>a pre-upgrade dump"]
    dump --> files[("./backups/<br/>DB_TIMESTAMP.dump")]
    pre --> files
    files --> prune["Retention prunes old dumps,<br/>pre-upgrade ones included"]
    files --> restore["restore.sh: drop, recreate,<br/>pg_restore --no-owner"]
    restore --> check[("A throwaway database to check it,<br/>or Finances itself, with --force")]

    classDef store fill:#e3ecfd,stroke:#3b63c4,color:#0f1f4d
    class files,check store
```

The `backup-smoke` workflow runs a dump and a restore every week. The image that dumps is built on
the same PostgreSQL tag as the server, because `pg_dump` refuses a newer server
([backups.md](backups.md)).

## From a change to a deployment

```mermaid
flowchart LR
    pr["Issue branch PR<br/>issue/N-slug"] --> ci(["CI: ci, image, e2e,<br/>Title and description"])
    dep(["Dependabot PR<br/>Upgrade: bump …"]) --> ci
    ci --> merge{{"Review, then<br/>squash-merge to master"}}
    merge --> rel["Release PR<br/>release/vX.Y.Z"] --> tag{{"Tag vX.Y.Z"}}
    tag --> gates(["release.yml: the changelog gate,<br/>then release.mjs verify"])
    gates --> build(["Build, boot, and verify<br/>the four images and the bundle"])
    build --> publish(["Push the images to GHCR,<br/>publish the Release"])
    publish --> deploy{{"deploy.sh X.Y.Z on the server:<br/>pull, backup gate, up, health gate"}}

    classDef you fill:#fdf0d5,stroke:#b7791f,color:#3d2a00
    classDef auto fill:#e2f3e6,stroke:#2f7d43,color:#0f3d1a
    class merge,tag,deploy you
    class ci,dep,gates,build,publish auto
```

An image that fails its own boot-and-health check never reaches the registry. On the server,
`deploy.sh` rolls the application back to the previous version if the new one fails its health gate;
the database comes back only from the pre-upgrade dump, because the migrations have no down steps
([releases.md](releases.md), [deployment.md](deployment.md)).

## Data model

The core tables, as Drizzle defines them in `app/drizzle/schema.ts`. Every insert, update, and
delete on them is recorded in `audit_log`; the views (`v_transactions_full`,
`v_account_balances_current`, `v_daily_totals`, and `v_audit_log`) read over them.

```mermaid
erDiagram
    account_type_categories ||--o{ account_types : groups
    account_types ||--o{ accounts : types
    accounts ||--o{ transactions : "posts to"
    accounts |o--o{ transactions : "is the other side of"
    transaction_types ||--o{ transactions : classifies
    transaction_categories ||--o{ transactions : categorizes
    accounts ||--o{ account_balance_history : "has a balance history"
    transactions ||--o| balance_transfers : "is the transfer of"
    transactions |o--o| balance_transfers : "is the fee of"
    accounts ||--o{ recurring_transactions : "is scheduled on"
    accounts |o--o{ recurring_transactions : "is the other side of"
    transaction_types ||--o{ recurring_transactions : classifies
    transaction_categories ||--o{ recurring_transactions : categorizes
    recurring_transactions |o..o{ transactions : "added, by id and date"
    users {
        int user_id PK
        text username
        text password_hash
    }
    audit_log {
        int audit_id PK
        timestamptz occurred_at
        text actor_label
        text table_name
        jsonb before_data
        jsonb after_data
    }
    import_log {
        int import_id PK
        char sha256
        text status
        int row_count
    }
```

`users`, `audit_log`, and `import_log` stand apart: the audit log names its actor by id and label
rather than by a foreign key, so it outlives the user, and the import log is keyed on content.
Schema changes go through a migration ([schema-changes.md](schema-changes.md)), and each release
says whether it can be rolled back ([releases.md](releases.md)).
