# Development Process

Finance Stack follows the shared development process in `~/.claude/dev_process/PROCESS.md`: a branch
and a pull request per issue, squash merges into `master`, the shared issue forms and PR titles, and
the shared version calculator. This page adds only what's specific to Finance Stack, and records
where it still does things its own way. The facts the process needs, such as commands and the
default branch, are in the Dev process table in `CLAUDE.md`; the workflow and every CI gate are in
[CONTRIBUTING.md](../CONTRIBUTING.md), and the architecture is in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Differences from the shared process

| Area         | This project                                                                                                                                                                                                                                                                                                                                | Why, and whether to converge                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Changelog    | Each entry is a bold headline and paragraphs with issue or PR links, which the About page renders (`app/lib/changelog.ts`), and every release declares a `**Migration:**` marker (`none`, `backward-compatible`, or `breaking`). A breaking migration also starts its entry `**Breaking:**`, and the changelog gate holds the two together. | The marker answers whether an operator can roll back by re-pinning the previous image, which the sections don't model (docs/releases.md). Keep. |
| Versions     | A release also sets `app/package.json` (`npm version`), and the changelog gate holds it, the newest section, and the tag together.                                                                                                                                                                                                          | The images and the About page report it. Keep.                                                                                                  |
| Dependabot   | Nothing is merged by CI: every bump is reviewed and passes the full gate suite (Issue #131).                                                                                                                                                                                                                                                | Converge only if the review load grows: the shared low-risk merge is one job in `ci.yml`.                                                       |
| Labels       | Unprefixed areas (`frontend`, `backend`, `infrastructure`, `testing`, `security`, `tech-debt`, `developer-experience`, and `documentation`, which is also a starting label) applied at triage, and Dependabot's ecosystem labels, all created by hand rather than from `.github/labels.project.json`.                                       | They work beside the starting labels. Keep.                                                                                                     |
| Actions      | Every action is pinned by commit SHA (Issue #131).                                                                                                                                                                                                                                                                                          | The synced workflows are pinned the same way.                                                                                                   |
| Decisions    | Recorded in the guides and in issue threads; `docs/decisions/` starts empty.                                                                                                                                                                                                                                                                | New decisions that are costly to reverse get an ADR there.                                                                                      |
| Older issues | Issues filed before the shared forms keep their descriptive titles, without roadmap ids.                                                                                                                                                                                                                                                    | Retitling them adds nothing. New issues use the forms and roadmap ids.                                                                          |

## Definition of Ready additions

- [ ] A schema change names its `**Migration:**` marker and how an operator rolls back
      (docs/schema-changes.md).
- [ ] A new server action follows the validation checklist (docs/input-validation.md), and says what
      it records in the audit log (docs/audit-log.md).
- [ ] A change to the deployment (services, profiles, or environment variables) lists what changes
      in both `docker-compose.yml` and `deploy/compose.yml`.

## Definition of Done additions

- [ ] CI passes: `ci` (every gate in CONTRIBUTING.md: schema drift, seed references, role
      privileges, the changelog, the docs index, the dependency audit, lint, types, and tests),
      `image` (deploy-bundle parity and the image scan), `e2e`, and `Title and description`.
- [ ] A schema change ships its migration, and sets or escalates the `**Migration:**` marker on
      `## [Unreleased]`; a `breaking` one also starts its entry `**Breaking:**`.
- [ ] The CHANGELOG entry links its issue or PR, and is in the section that sets the right bump
      (docs/releases.md, "Choosing the bump").
- [ ] A new guide in `docs/` is listed in both indexes, docs/README.md and README.md.

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

| Level              | Tool                                                                                        | Where it runs                             |
| ------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Static             | ESLint, TypeScript, and the gates in CONTRIBUTING.md                                        | CI (`ci`, `image`), and each gate locally |
| Unit and component | Vitest: `test:unit` and `test:jsdom` in `app/`                                              | CI (`ci`)                                 |
| Integration        | Vitest `test:integration` against PostgreSQL, and the importer's `pytest` suite             | CI (`ci`)                                 |
| End to end         | Playwright (`app/e2e/`)                                                                     | CI (`e2e`)                                |
| Release QA         | The deploy and backup smoke workflows, then the upgrade in docs/deployment.md on the server | Weekly and on change, then by hand        |

## Release

- **How:** [docs/releases.md](releases.md). `/release` runs the shared calculator
  (`node scripts/dev-process/release.mjs next`), closes the section with `prepare`, sets the
  `**Migration:**` marker and `app/package.json`, and opens a `Release: vX.Y.Z` pull request from
  `release/vX.Y.Z`; the tag on `master` follows the merge.
- **No floors:** `.github/release.json` isn't needed. A migration doesn't raise the bump by itself;
  a breaking one is a major through its `**Breaking:**` entry.
- **What it builds:** `.github/workflows/release.yml`, on a `v*` tag, runs the changelog gate and
  `release.mjs verify`, then builds, boots, and verifies the four published images and the deploy
  bundle (`scripts/pack-bundle.sh`) before it pushes them.
- **Installing it:** docs/deployment.md and deploy/README.md.

## Upgrades

- **Dependabot** opens npm (`app/`), pip (`importer/`), Docker, Compose, and GitHub Actions updates
  weekly against `master`, titled `Upgrade: bump …`, and nothing is merged by CI (see Differences).
- **Changelog:** a bump that ships but changes nothing an operator notices goes under
  `### Dependencies`, a patch; one they notice, such as a service's new major, under `### Changed`.
- **High risk:** Node majors (the images and CI move together, as in Issue #211), PostgreSQL majors
  (`pg_dump` must match the server), Next.js majors, and Metabase or GlitchTip versions that migrate
  their own databases one way.
- **Stored data:** Drizzle migrations (docs/schema-changes.md). The `**Migration:**` marker says
  whether an upgrade can be rolled back by re-pinning the previous image.

## Automation

| Automation                                    | Trigger                                  | Lives in                                                                   |
| --------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| Lint, types, tests, and the gates             | Pushes to `master`, and every PR         | `.github/workflows/ci.yml` (`ci`, `image`, `e2e`)                          |
| Dev process check                             | The same                                 | `.github/workflows/ci.yml` (in `ci`)                                       |
| Secret scan                                   | Pushes to `master`, every PR, and weekly | `.github/workflows/secret-scan.yml`                                        |
| Backup and deploy smoke tests                 | Weekly, and PRs that touch their scripts | `.github/workflows/backup-smoke.yml`, `.github/workflows/deploy-smoke.yml` |
| Check the tag, publish images and the Release | A `v*` tag                               | `.github/workflows/release.yml`                                            |
| Dependency update PRs                         | Weekly                                   | `.github/dependabot.yml`                                                   |

The shared workflows (the PR standards check, the Claude review, `@claude`, labels, and triage) are
in the process's "What's automated".

## Repository setup

- The `master` ruleset requires `ci`, `image`, `e2e`, and `Title and description`.
- Squash merging only, with the PR title as the commit message, and automatic deletion of head
  branches.
- The Claude review needs the `CLAUDE_CODE_OAUTH_TOKEN` and `DEV_PROCESS_SSH_KEY` secrets; it's
  skipped with a notice until both are set.
- Once this lands: delete the `test` and `patch` branches.

## Terms

| Term             | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Profile          | An optional Compose service set, listed in `COMPOSE_PROFILES`: `bi`, `errors`, or `edge` |
| Migration marker | A release's `**Migration:**` line: `none`, `backward-compatible`, or `breaking`          |
| Lookups          | The reference tables the migrate job seeds, such as the transaction categories           |
| Deploy bundle    | The release's compose files and scripts that a server installs (deploy/README.md)        |

## Known gaps

- The Claude review waits for its two secrets.
- Nothing checks that a Dependabot bump that ships has its `### Dependencies` entry before the
  release; `/release` asks for one.
