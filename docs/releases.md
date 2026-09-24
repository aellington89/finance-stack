# Releases & Tagging

How Finance Stack versions, tags, and publishes releases.

## Versioning

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The release history lives in [`CHANGELOG.md`](../CHANGELOG.md) (Keep a Changelog
format); each released version has its own `## [X.Y.Z] - YYYY-MM-DD` section.

### Choosing the bump

| Bump | When | Example |
|---|---|---|
| **major** | The release is breaking — most often `**Migration:** breaking`, meaning the previous app version does not run against the new schema and the upgrade is one-way. | `1.4.2` → `2.0.0` |
| **minor** | New functionality, backward-compatible. | `1.0.2` → `1.1.0` |
| **patch** | Fixes, chores, dependency bumps. | `1.0.2` → `1.0.3` |

The release-notes generator derives this for you and prints it in the heading it
drafts, reading two things already standing on `## [Unreleased]` — both written
by each PR as it lands
([CONTRIBUTING.md](../CONTRIBUTING.md#changelog-entries-day-to-day)):

- **A `breaking` `**Migration:**` marker is a major** post-1.0, and the changelog
  gate enforces that ([#315](https://github.com/aellington89/finance-stack/issues/315)).
- **An entry under `### Added` is a minor.** Keep a Changelog defines that section
  as new features, which is semver's minor exactly.
- **Otherwise an `enhancement` label is a minor** — read from every issue *and* PR
  the range references, including the `(#N)` refs in a squash title — and
  anything else is a patch.

`### Added` outranks the label because labels drift: they are chosen on the issue,
often before the work is understood. [#124](https://github.com/aellington89/finance-stack/issues/124)
added a table, a migration and an import log under `bug`, and
[#232](https://github.com/aellington89/finance-stack/issues/232) added error
tracking under `infrastructure`/`backend`; with neither labelled `enhancement`,
the `[Unreleased]` that held them drafted as a patch. A `backward-compatible`
marker is not a minor signal on its own — an index-only migration can ship in a
fix, and it still rolls back by re-pinning the image.

**The marker only sees the database.** It answers "can an operator roll back by
re-pinning the previous image?", which is not the same question as "is this
release backward-compatible?". A removed environment variable, a changed
deployment contract, or any other broken published interface is a major that
ships `**Migration:** none` — nothing derives that for you, so say so with
`--bump=major`:

```sh
npm run release:notes -- <prev-tag>..HEAD --changelog --bump=major
```

The value attaches with `=`; a space-separated `--bump major` is rejected rather
than being read as the git range. `--bump=` lowers as well as raises, for the
case where a `breaking` marker overstates the impact — though if that marker
still stands when the section is closed, the gate will reject the release, so
correct the marker instead of overriding past it.

Before `v1.0.0` a breaking change legitimately shipped as a minor, and the
generator still applies that rule below `1.0.0`. Every release in this
repository's history is past that boundary now.

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
logs in to GHCR and pushes. The push steps carry no `if:` condition, so any
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
unpacks to a single `finance-stack-X.Y.Z/` directory containing `compose.yml`,
`.env.example` (with `APP_VERSION` already stamped to that release),
`finance-stack.service`, `caddy/Caddyfile`, a `README.md` runbook, and empty
`imports/`, `importer/parsers/` and `backups/` directories for the bind mounts.

That bundle is the whole deployment — a host needs Docker and nothing else. See
[Deployment & Exposure](deployment.md#the-deployment-bundle).

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

The repeatable steps for cutting a new release `vX.Y.Z`. The CI changelog gate
(`npm run check:changelog`, runs on every push/PR and on `v*` tag pushes —
[#173](https://github.com/aellington89/finance-stack/issues/173)) enforces that
`package.json` version == the newest `CHANGELOG.md` release, that the release
carries a valid `**Migration:**` marker
([#277](https://github.com/aellington89/finance-stack/issues/277)), that a
release declaring `**Migration:** breaking` incremented its major
([#315](https://github.com/aellington89/finance-stack/issues/315) — pre-1.0
releases exempt), and that a pushed tag is a well-formed `vX.Y.Z` matching that
version.

Set the version once:

```sh
ver=0.1.4
```

1. **Draft the changelog entries.** The release-notes generator
   ([#170](https://github.com/aellington89/finance-stack/issues/170)) reads the
   commit range, fetches GitHub issue labels, reads the `**Migration:**` marker on
   `## [Unreleased]`, and prints a draft Keep-a-Changelog block with issue-linked
   bullets and a suggested semver bump to **stdout** (it does not edit any files):

   ```sh
   cd app
   npm run release:notes -- <prev-tag>..HEAD --changelog
   ```

   Review the output, confirm the suggested bump — the heading comment says what
   drove it, and [Choosing the bump](#choosing-the-bump) covers the case the
   marker cannot see — and re-sort the bullets into the correct `### Added`,
   `### Changed`, `### Fixed`, or `### Security` subsections under
   `## [Unreleased]` in `CHANGELOG.md`. (`--release` mode emits a GitHub Release
   body instead.)

   The version in `app/package.json` is still the *previous* release at this
   point; it is bumped in step 3, after the number is chosen.

2. **Close the CHANGELOG section.** Rename `## [Unreleased]` to
   `## [X.Y.Z] - YYYY-MM-DD`, keeping the `### Added/Changed/Fixed/Security`
   headings and every `([Issue #N])` link. Open a fresh empty `## [Unreleased]`
   above it, and update the reference links at the bottom (add
   `[X.Y.Z]: …/compare/<prev>...vX.Y.Z` and repoint `[Unreleased]` to
   `vX.Y.Z...HEAD`). Commit on the release commit.

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

3. **Tag** — annotated, `vX.Y.Z`, on that commit, then push (see
   [Tagging convention](#tagging-convention)):

   ```sh
   git tag -a "v$ver" -m "v$ver — <one-line summary>"
   git push origin "v$ver"
   ```

4. **Publish the images and the Release** — handled automatically by
   `.github/workflows/release.yml` when the tag is pushed (step 3). The workflow
   builds the four images, boots and verifies the stack, pushes the images to
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
git switch -c release/X.Y.Z vX.Y.<prev>
```

Two things about this are easy to get wrong.

**Do not merge Dependabot PRs into that branch — cherry-pick them.** Retargeting
a Dependabot PR (`gh pr edit <n> --base release/X.Y.Z`) makes Dependabot rebase
the branch onto its configured `target-branch` from `.github/dependabot.yml`,
which is `patch` — *not* onto the new base the PR now points at. Because `patch`
tracks `master`, the rebased commit's parent becomes a `master` commit, and
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

**Do not trust the derived bump on a maintenance release.** The generator reads
`[Unreleased]` from the working tree, but a maintenance branch is cut from an
older tag precisely so that some of `[Unreleased]` does *not* ship — so the
marker can describe work the release withholds. Cutting `v1.0.2` from `v1.0.1`
while [#124](https://github.com/aellington89/finance-stack/issues/124) stayed
behind is exactly that shape. Choose the number against what the tag actually
carries and pass it with `--bump=`.

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
