# Development Process

Finance Stack follows the shared development process in `~/.claude/dev_process/PROCESS.md`. This
page adds only what's specific to Finance Stack, and records where it does things its own way.
The facts the process needs, such as commands and the default branch, are in the Dev process
table in `CLAUDE.md`; the workflow and every CI gate are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Differences from the shared process

| Area                   | This project                                                                                                                                                                                                                                                                                                                             | Why, and whether to converge                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branching              | Work commits straight to `test`, with a branch only when a change needs isolation, and reaches `master` in a `test` → `master` PR. Dependabot targets `patch` (`dependabot-retarget.yml` moves security updates there too), merged up in "Dependency batch" PRs.                                                                         | CONTRIBUTING.md, "Branching & pull requests". Converging changes CI's triggers, Dependabot's target, and the retarget workflow, so it deserves its own ADR and PR. |
| Pull requests          | Issue PRs are titled `Issue #N - <summary>`, as in the shared process, but use the project's own `.github/PULL_REQUEST_TEMPLATE.md`; dependency batches are `Dependency batch: …`. The shared PR template and PR title check aren't synced.                                                                                              | The shared check would reject the batch titles today. Converge together with the branching.                                                                        |
| Issues                 | The project's own `bug.yml` and `feature.yml` forms, descriptive titles without roadmap ids, and the roadmap in GitHub Projects. The shared forms aren't synced.                                                                                                                                                                         | Projects already hold the plan. Keep.                                                                                                                              |
| Labels                 | Unprefixed areas (`frontend`, `backend`, `infrastructure`, `testing`, `security`, `documentation`, `tech-debt`, `developer-experience`), and Dependabot's ecosystem labels.                                                                                                                                                              | They work, and `release:notes` reads `enhancement`. The process labels are added beside them. Keep.                                                                |
| Changelog and versions | Keep a Changelog, plus a `**Migration:**` marker (`none`, `backward-compatible`, or `breaking`) on every release. `### Changed`, where dependency bumps go, is a patch; an `enhancement` label raises a release to a minor. `release:notes` derives the bump, and the changelog gate enforces it. The shared `release.mjs` isn't synced. | The marker answers whether an operator can roll back by re-pinning the previous image, which the shared rules don't model (docs/releases.md). Keep.                |
| Actions                | Every action is pinned by commit SHA (Issue #131).                                                                                                                                                                                                                                                                                       | The synced workflows are pinned the same way.                                                                                                                      |
| Decisions              | Recorded in the guides and in issue threads; `docs/decisions/` starts empty.                                                                                                                                                                                                                                                             | New decisions that are costly to reverse get an ADR there.                                                                                                         |

## Definition of Ready additions

- [ ] A schema change names its `**Migration:**` marker and how an operator rolls back
      (docs/schema-changes.md).
- [ ] A new server action follows the validation checklist (docs/input-validation.md), and says
      what it records in the audit log (docs/audit-log.md).
- [ ] A change to the deployment (services, profiles, or environment variables) lists what
      changes in both `docker-compose.yml` and `deploy/compose.yml`.

## Definition of Done additions

- [ ] Every CI gate in CONTRIBUTING.md passes: schema drift, seed references, role privileges,
      the changelog, deploy-bundle parity, the docs index, the dependency audit, and the image
      scan.
- [ ] A new guide in `docs/` is listed in both indexes, docs/README.md and README.md.
- [ ] The CHANGELOG entry is in the section that sets the right bump (docs/releases.md).

## Code review additions

### Data safety

- Migrations come from `npm run db:generate` (docs/schema-changes.md), and the release's
  `**Migration:**` marker tells the truth about rollback.
- Every mutation writes the audit log (docs/audit-log.md).

### Security

- Every page and server action rejects unauthenticated requests and validates its input
  (docs/input-validation.md, and the README's "Security").
- No secret in code, logs, or images (docs/secrets.md); the secret scan runs on every push.
- Every action is pinned by commit SHA.

## Testing

| Level              | Tool                                                                                        | Where it runs                      |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------- |
| Static             | ESLint, TypeScript, and the gates in CONTRIBUTING.md                                        | CI (`ci`), and each gate locally   |
| Unit and component | Vitest: `test:unit` and `test:jsdom` in `app/`                                              | CI (`ci`)                          |
| Integration        | Vitest `test:integration` against PostgreSQL, and the importer's `pytest` suite             | CI (`ci`)                          |
| End to end         | Playwright (`app/e2e/`)                                                                     | CI (`ci`)                          |
| Release QA         | The deploy and backup smoke workflows, then the upgrade in docs/deployment.md on the server | Weekly and on change, then by hand |

## Release

- **How:** [docs/releases.md](releases.md): `release:notes` derives the version from the
  changelog, the `**Migration:**` marker, and the `enhancement` labels; the section is closed
  and `app/package.json` set to match.
- **What it builds:** `.github/workflows/release.yml`, on a `v*` tag, builds the published
  images and the deploy bundle (`scripts/pack-bundle.sh`).
- **Installing it:** docs/deployment.md and deploy/README.md.

## Upgrades

- **Dependabot** opens npm (`app/`), pip (`importer/`), Docker, and GitHub Actions updates
  against `patch` (see Differences), merged up in "Dependency batch" PRs.
- **High risk:** Node majors (the images and CI move together, as in Issue #211), PostgreSQL
  majors (`pg_dump` must match the server), Next.js majors, and Metabase or GlitchTip versions
  that migrate their own databases one way.
- **Stored data:** Drizzle migrations (docs/schema-changes.md). The `**Migration:**` marker
  says whether an upgrade can be rolled back by re-pinning the previous image.

## Automation

| Automation                        | Trigger                                             | Lives in                                                                   |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Lint, types, tests, and the gates | Pushes to `master` and `test`, and every PR         | `.github/workflows/ci.yml` (`ci`, `image`)                                 |
| Dev process check                 | The same                                            | `.github/workflows/ci.yml` (in `ci`)                                       |
| Secret scan                       | Pushes to `master` and `test`, every PR, and weekly | `.github/workflows/secret-scan.yml`                                        |
| Backup and deploy smoke tests     | Weekly, and PRs that touch their scripts            | `.github/workflows/backup-smoke.yml`, `.github/workflows/deploy-smoke.yml` |
| Move Dependabot PRs onto `patch`  | A Dependabot PR against `master`                    | `.github/workflows/dependabot-retarget.yml`                                |
| Images and the deploy bundle      | A `v*` tag                                          | `.github/workflows/release.yml`                                            |
| Dependency update PRs             | Dependabot's schedule                               | `.github/dependabot.yml`                                                   |

## Repository setup

- A ruleset for `master` requires the CI jobs `ci` and `image`. The shared PR title check isn't
  synced, so there's no `Title and description` check to require.
- The Claude review needs the `CLAUDE_CODE_OAUTH_TOKEN` and `DEV_PROCESS_SSH_KEY` secrets; it's
  skipped with a notice until both are set.

## Terms

| Term             | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Profile          | An optional Compose service set, listed in `COMPOSE_PROFILES`: `bi`, `errors`, or `edge` |
| Migration marker | A release's `**Migration:**` line: `none`, `backward-compatible`, or `breaking`          |
| Lookups          | The reference tables the migrate job seeds, such as the transaction categories           |
| Deploy bundle    | The release's compose files and scripts that a server installs (deploy/README.md)        |

## Known gaps

- The shared issue forms, PR template, and PR title check aren't in use until the branching
  converges (see Differences).
- The Claude review waits for its two secrets.
