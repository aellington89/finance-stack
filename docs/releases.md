# Releases & Tagging

How Finance Stack versions, tags, and publishes releases.

## Versioning

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The release history lives in [`CHANGELOG.md`](../CHANGELOG.md) (Keep a Changelog
format); each released version has its own `## [X.Y.Z] - YYYY-MM-DD` section.

### Choosing the bump

The version is derived, not chosen. The shared dev process's calculator reads the
sections under `## [Unreleased]`, each written by the PR that landed it
([CONTRIBUTING.md](../CONTRIBUTING.md#changelog-entries-day-to-day)), and the
largest bump wins. Run it from the repository root:

```sh
node scripts/dev-process/release.mjs next
```

| Bump | When | Example |
|---|---|---|
| **major** | An entry starts `**Breaking:**`, or there is a `### Removed` section. | `1.4.2` → `2.0.0` |
| **minor** | An entry under `### Added`, `### Changed`, or `### Deprecated`. | `1.0.2` → `1.1.0` |
| **patch** | Only `### Fixed`, `### Security`, or `### Dependencies` entries. | `1.0.2` → `1.0.3` |
| none | Only `### Internal` or `### Deferred` entries: nothing to release. | |

It prints every reason beside the version. The calculator belongs to the shared
process ([`aellington89/dev_process`](https://github.com/aellington89/dev_process)),
which syncs it into `scripts/dev-process/` and tests it there; this repository
sets no floors in `.github/release.json`.

- **A breaking migration is a major.** A section that declares
  `**Migration:** breaking` must also start the migration's entry with
  `**Breaking:**`, because the calculator reads entries and never the marker.
  The changelog gate fails a section that has one without the other, and still
  refuses to close a breaking release that is not a major
  ([#315](https://github.com/aellington89/finance-stack/issues/315)).
- **A `backward-compatible` marker is not a minor signal on its own.** An
  index-only migration can ship in a fix, and it still rolls back by re-pinning
  the image.
- **Dependency bumps that change nothing an operator notices go under
  `### Dependencies`,** which is a patch, whether they reach `finance-app` or only
  the full `node_modules` that `finance-migrate` copies. `v1.0.1` to `v1.0.4` were
  releases of exactly this kind. A bump an operator does notice, such as a
  service's new major, goes under `### Changed`; one that reaches no published
  image, such as a CI action, goes under `### Internal` or gets no entry.

**The marker only sees the database.** It answers "can an operator roll back by
re-pinning the previous image?", which is not the same question as "is this
release backward-compatible?". A removed environment variable, a changed
deployment contract, or any other broken published interface is a major that
ships `**Migration:** none`: start its entry `**Breaking:**` and say what
operators must do.

To override the computed version, give one to `prepare` (see
[Release procedure](#release-procedure)). The release workflow runs
`node scripts/dev-process/release.mjs verify vX.Y.Z` before it builds anything: it
fails a tag that is a smaller step than its section needs, and warns about a
bigger one.

## Tagging convention

Release tags are the **only** legal tag shape:

```
vX.Y.Z          e.g. v0.1.3
vX.Y.Z-alpha.N  for pre-releases, e.g. v0.1.0-alpha.5
```

Rules:

- **`v` prefix, no stray dots.** `v0.1.3` is valid; `v.0.1.3`, `0.1.3`, and
  `v0.1.3.1` are not.
- **The CI changelog gate enforces `vX.Y.Z` (stable only).** Pre-release tags
  (`-alpha.N`) are a documented convention but are not yet validated by the gate —
  pushing one on a `v*` tag trigger will fail the tag-format check. Broadening the
  regex is a future extension.
- **Annotated, not lightweight.** Create release tags with `git tag -a` so they
  carry a tagger, date, and message:

  ```sh
  git tag -a v0.1.4 -m "v0.1.4 — <one-line summary>"
  git push origin v0.1.4
  ```

- **One tag per `CHANGELOG.md` version,** placed on the commit that ships that
  version.

## GitHub Releases

Every `vX.Y.Z` tag has a matching GitHub Release whose **body is the
corresponding `CHANGELOG.md` section** — the `**Migration:**` marker followed by
the `### Added/Changed/Fixed/Security` lists, with their `([Issue #N])` links
preserved — plus a `**Full Changelog**` compare link. The workflow slices
everything between the release heading and the next one, so the marker reaches
the published Release without any extra step.

**Pushing an annotated tag triggers the automated release workflow**
(`.github/workflows/release.yml`, [Issue #175](https://github.com/aellington89/finance-stack/issues/175)),
which runs the version/tag-consistency gate, builds the four stamped Docker
images, boots the stack and verifies it, pushes the images to GHCR, and publishes
the Release — procedure steps 4–5 are handled by CI.

To manually create or refresh a release body (local fallback):

```sh
gh release create v0.1.4 --title v0.1.4 --notes-file <changelog-section.md>
# or, to update an existing release:
gh release edit v0.1.4 --notes-file <changelog-section.md>
```

## Published images

Decision record: [0004](decisions/0004-releases-ship-ghcr-images-and-a-deploy-bundle.md), why releases ship images and a bundle, and what the migration marker promises.

Every `vX.Y.Z` tag publishes four images to the GitHub Container Registry
([Issue #226](https://github.com/aellington89/finance-stack/issues/226)):

| Package | Contains |
|---|---|
| `ghcr.io/aellington89/finance-app` | the Next.js standalone server |
| `ghcr.io/aellington89/finance-migrate` | drizzle-kit, `/roles`, `/seeds`, `verify-db-roles.sh` |
| `ghcr.io/aellington89/finance-importer` | `poll.py` and its pinned dependencies |
| `ghcr.io/aellington89/finance-backup` | `backup.sh`, `restore.sh`, the balance-rebuild SQL |

Each is pushed at **two tags**: `:X.Y.Z`, and `:<full-sha>` — the 40-character
commit SHA, which is the same value `/api/health` reports as `build.gitSha`. A
running container therefore traces back to the exact health response that cleared
it, and a deploy can pin either a version or a commit.

```sh
docker pull ghcr.io/aellington89/finance-app:0.4.0
docker pull ghcr.io/aellington89/finance-app:8f3c1d2...   # same image, SHA-tagged
```

**The publish happens after verification, never before.** The workflow builds all
four images, boots the full stack from them, asserts `/api/health` reports the
expected version and SHA, asserts the container healthchecks agree, and only then
logs in to GHCR and pushes. The same boot checks the Metabase metadata role too: its
`MB_DB_USER` must equal `deploy/.env.example`'s before anything starts, and the
role must be in `pg_roles` once the app answers, because a 200 proves neither
([#260](https://github.com/aellington89/finance-stack/issues/260)). Nothing but a
tag runs this step. To rehearse it on a machine with a stack already running,
give the rehearsal its own project name, container names, and loopback ports
(`ports: !override`): a project name alone shares the ports, so `/api/health`
can answer from the live app. #260 has the full recipe. The push steps carry no `if:` condition, so any
earlier failure skips them: an image that fails its own smoke test cannot reach
the registry, and no GitHub Release is created either.

Images are built for **`linux/amd64` only**. Verifying an image means running it,
so an arm64 publish (a Pi or a NAS) needs its own verified build — either a buildx
multi-platform build whose arm64 half boots on an arm64 runner, or a second
self-hosted runner. Adding `--platform linux/amd64,linux/arm64` alone would
publish an arm64 image nothing ever started.

### One-time setup on first publish

GHCR creates new packages **private**, even from a public repository. After the
first tag that publishes them, open each of the four packages under
[the account's Packages tab](https://github.com/aellington89?tab=packages) and:

1. **Package settings → Change visibility → Public.** Until this is done,
   `docker pull` on a deployment host asks for credentials.
2. **Enable "Inherit access from repository"**, so repo collaborators keep write
   access without a separate grant.

This is expected on the first run and is not a workflow failure — nothing in the
run log reports it, because the push itself succeeds.

## Deployment bundle

Every `vX.Y.Z` tag also attaches `finance-stack-X.Y.Z.tar.gz` to the Release,
along with a `.sha256` checksum
([Issue #227](https://github.com/aellington89/finance-stack/issues/227)). It
unpacks to a single `finance-stack-X.Y.Z/` directory containing `deploy.sh`,
`compose.yml`, `.env.example`, `finance-stack.service`, `caddy/Caddyfile`, a
`README.md` runbook, and empty `imports/`, `importer/parsers/` and `backups/`
directories for the bind mounts.

That bundle is the whole deployment — a host needs Docker and nothing else. See
[Deployment & Exposure](deployment.md#the-deployment-bundle).

**`scripts/pack-bundle.sh X.Y.Z OUTDIR` packs it**, for `release.yml` and for
`deploy-smoke.yml` alike ([#347](https://github.com/aellington89/finance-stack/issues/347)).
It packs the git-tracked files under `deploy/`, so a file added there ships by
existing, while a checkout's real `.env`, dumps and deploy state never can. It
stamps three placeholders with the version and fails unless each lands exactly
once:

| File | Placeholder in git | Stamped for |
|---|---|---|
| `.env.example` | `APP_VERSION=changeme` | a first install that needs no edit |
| `compose.yml` | `# finance-stack bundle: unreleased` (line 1) | `deploy.sh` telling which release a host's file came from, and whether it was edited since |
| `deploy.sh` | `DEPLOY_SCRIPT_VERSION="unreleased"` | the script's forward-only self-update |

Run it locally to rehearse an upgrade against the checkout rather than a release.

**The bundle is now an interface that deployed hosts depend on.** Since #347
`deploy.sh` downloads `vX.Y.Z/finance-stack-X.Y.Z.tar.gz` and its `.sha256` from
the Release on every upgrade. It insists on the one top-level
`finance-stack-X.Y.Z/` directory, plain files only, and a checksum line naming
the tarball. Renaming the asset, changing its layout or changing the checksum
format breaks every host's next upgrade. So does a release that ships the
`unreleased` placeholders, which the script reads as a checkout and never
installs.

Two details of how the workflow builds it are worth knowing:

- **It is packed before any Docker work**, for the same reason the changelog gate
  runs first: a packaging bug should cost nothing, and must never fail *after*
  images have reached GHCR, which cannot be undone.
- **`caddy/Caddyfile` is copied in at pack time** from the repo root rather than
  committed under `deploy/`, so there is one source of truth. The consequence is
  that `--profile edge` cannot be started from `deploy/compose.yml` inside a
  checkout; use the repo's `docker-compose.yml` for that.

Verification runs against `deploy/compose.yml`, not the dev compose — the file
that ships is the file that gets smoke-tested. The images are tagged with their
final registry references *before* that boot, so they are verified under the
names they publish under, and the push still happens only afterwards.

## Release procedure

The repeatable steps for cutting a new release `vX.Y.Z`. Do them on a
`release/vX.Y.Z` branch and open a pull request titled `Release: vX.Y.Z`, so the
cut goes through CI like any other change; `/release` does steps 1 to 3 and opens
it. The CI changelog gate (`npm run check:changelog`, runs on every push/PR and
on `v*` tag pushes —
[#173](https://github.com/aellington89/finance-stack/issues/173)) enforces that
`package.json` version == the newest `CHANGELOG.md` release, that the release
carries a valid `**Migration:**` marker
([#277](https://github.com/aellington89/finance-stack/issues/277)), that a
release declaring `**Migration:** breaking` incremented its major
([#315](https://github.com/aellington89/finance-stack/issues/315) — pre-1.0
releases exempt) and has an entry that starts `**Breaking:**`, and that a pushed
tag is a well-formed `vX.Y.Z` matching that version.

1. **Check the entries, then derive the version.** Every PR merged since the
   last tag (`git log <prev-tag>..HEAD --oneline`) has its entry under
   `## [Unreleased]`, or is a chore. Add one entry under `### Dependencies` for
   Dependabot bumps that ship, and check each entry's section against
   [Choosing the bump](#choosing-the-bump), since the sections decide the
   version. Then, from the repository root:

   ```sh
   node scripts/dev-process/release.mjs next
   ```

   It prints the current version, the next one, and every reason for the bump.

2. **Close the CHANGELOG section,** from the repository root:

   ```sh
   node scripts/dev-process/release.mjs prepare          # or: prepare X.Y.Z to override
   ```

   It inserts `## [X.Y.Z] - YYYY-MM-DD` below a fresh, empty `## [Unreleased]`,
   keeping every section and `([Issue #N])` link, and updates the reference links
   at the bottom.

   **Declare the migration impact** in the same edit — a `**Migration:**` line
   directly under the new heading, before the first `###`:

   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   **Migration:** backward-compatible

   ### Added
   ```

   | Value | Meaning |
   |---|---|
   | `none` | No migration in this release. |
   | `backward-compatible` | The previous app version runs fine against the new schema, so re-pinning the previous image is a sufficient rollback. |
   | `breaking` | Rolling back requires restoring the pre-upgrade dump. |

   This line is mandatory because `app/drizzle/migrations/` contains only `up`
   SQL — drizzle-kit does not generate down migrations. Reverting a schema change
   means a dump restore, not an image re-pin, and this is where an operator learns
   that *before* upgrading rather than during a failed rollback
   ([#277](https://github.com/aellington89/finance-stack/issues/277)).

   Choose by asking whether the **previous** app version still runs against the
   **new** schema. Additive DDL — new tables, nullable columns, indexes — is
   normally `backward-compatible`; dropping or renaming a column, or adding a
   constraint the old app would violate, is `breaking`. If the release ships no
   migration at all, it is `none`.

   Values are exact and lower-case; `Breaking` fails the gate rather than being
   read as `breaking`. `[Unreleased]` need not carry a marker, but if it does, the
   value still has to be one of the three.

3. **Bump `app/package.json`** to match, which also updates its lockfile, and
   run the gate:

   ```sh
   cd app
   npm version X.Y.Z --no-git-tag-version
   npm run check:changelog
   ```

4. **Merge, then tag.** Squash-merge the release pull request, then tag
   `master`, annotated, `vX.Y.Z`, and push the tag (see
   [Tagging convention](#tagging-convention)):

   ```sh
   ver=X.Y.Z
   git switch master && git pull
   git tag -a "v$ver" -m "v$ver — <one-line summary>"
   git push origin "v$ver"
   ```

5. **Publish the images and the Release** — handled automatically by
   `.github/workflows/release.yml` when the tag is pushed (step 4). The workflow
   first runs the changelog gate and `release.mjs verify`, then builds the four
   images, boots and verifies the stack, pushes the images to
   GHCR (see [Published images](#published-images)), slices the `CHANGELOG.md`
   section, and calls `gh release create`. Monitor the run at
   `https://github.com/aellington89/finance-stack/actions`; the pushed image
   digests are recorded in the run summary.

   If you need to do this manually (local fallback):

   ```sh
   awk -v v="$ver" '
     $0 ~ "^## \\[" v "\\] " {flag=1; next}
     /^## \[/ {flag=0}
     flag
   ' CHANGELOG.md > "notes-$ver.md"

   gh release create "v$ver" --title "v$ver" --notes-file "notes-$ver.md"
   ```

   Add `--prerelease` for `-alpha.N` tags. Verify with
   `gh release view "v$ver"`.

## Maintenance releases (cutting from a tag)

Sometimes a release should carry only part of what is on `master` — most often
routine dependency bumps that want to reach a deployment without also taking on
a feature and its migration. `v1.0.2` was cut this way: it shipped three bumps
while [#124](https://github.com/aellington89/finance-stack/issues/124) stayed in
`[Unreleased]`, so rolling back from it was an image re-pin against an unchanged
schema rather than a dump restore.

**The tag decides what ships, not the changelog.** `release.yml` builds the four
images from whatever commit the tag points at, and it triggers on `tags: ['v*']`
with no branch filter — so a maintenance release is simply a branch cut from the
previous tag, tagged there, and merged back to `master` afterwards:

```sh
git switch -c release/vX.Y.Z vX.Y.<prev>
```

Two things about this are easy to get wrong.

**Do not merge Dependabot PRs into that branch — cherry-pick them.** Retargeting
a Dependabot PR (`gh pr edit <n> --base release/vX.Y.Z`) makes Dependabot rebase
the branch onto the branch it targets, `master` — *not* onto the new base the PR
now points at. The rebased commit's parent becomes a `master` commit, and
merging it drags everything on `master` into the release branch, feature and
migration included. This is not hypothetical: it happened while cutting `v1.0.2`
and was caught only because a `git pull` printed files that had no business on
that branch. Cherry-picking takes the diff without the ancestry and preserves
Dependabot's authorship:

```sh
git cherry-pick <bump-commit>
```

Verify before tagging, against the specific thing being withheld — for `v1.0.2`
that was the migration file, the table in `drizzle/schema.ts`, and
`importer/tests/`:

```sh
git merge-base --is-ancestor <withheld-commit> HEAD && echo CONTAMINATED
```

**Merge `master` in only after the tag exists.** The merge-back has to resolve a
`CHANGELOG.md` conflict — `master`'s `[Unreleased]` against the branch's new
`[X.Y.Z]` section — and resolving it means pulling `master` into the branch,
which brings the withheld work with it. Tag first and that is harmless, because
the tag is already pinned to the clean commit; tag afterwards and the release
ships what it was cut to avoid. Order is: cherry-pick, close the changelog, tag,
push the tag, *then* merge `master` in and open the merge-back PR.

A maintenance release is also a reminder that the version is not always the next
patch. `v1.0.2` was a patch because it carried only dependency bumps; the work it
deferred was `### Added`, which makes its own release a **minor**.

**Derive the bump on the maintenance branch, not on `master`.** The calculator
reads `[Unreleased]` from the working tree, and `master`'s describes work the
release withholds: cutting `v1.0.2` from `v1.0.1` while
[#124](https://github.com/aellington89/finance-stack/issues/124) stayed behind is
exactly that shape. Write the release's own entries on the branch, run
`node scripts/dev-process/release.mjs next` there, and pass a version to
`prepare` only if it still disagrees with what the tag carries. The release
workflow's `verify` reads the section on the tagged commit, so it checks the same
thing.

## One-time tag normalization (#167)

The `0.1.3` release was originally tagged `v.0.1.3` (a stray dot — also a
lightweight tag). Under [#167](https://github.com/aellington89/finance-stack/issues/167)
this was normalized as a one-time operation:

1. Recreated it as an **annotated** `v0.1.3` on the same commit (`26ece2c`) and
   pushed it.
2. Retargeted the existing GitHub Release to `v0.1.3`
   (`gh release edit v.0.1.3 --tag v0.1.3`).
3. Deleted the malformed tag locally and on origin
   (`git tag -d v.0.1.3` / `git push origin :refs/tags/v.0.1.3`).
4. Rebuilt the `v0.1.0`–`v0.1.3` release bodies from `CHANGELOG.md`.

This rewrote a remote tag ref (a force operation), which was acceptable because
nothing referenced these tags. The `vX.Y.Z` convention above is the rule going
forward.
