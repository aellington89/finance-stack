# Releases & Tagging

How Finance Stack versions, tags, and publishes releases.

## Versioning

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The release history lives in [`CHANGELOG.md`](../CHANGELOG.md) (Keep a Changelog
format); each released version has its own `## [X.Y.Z] - YYYY-MM-DD` section.

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

## Release procedure

The repeatable steps for cutting a new release `vX.Y.Z`. The CI changelog gate
(`npm run check:changelog`, runs on every push/PR and on `v*` tag pushes —
[#173](https://github.com/aellington89/finance-stack/issues/173)) enforces that
`package.json` version == the newest `CHANGELOG.md` release, that the release
carries a valid `**Migration:**` marker
([#277](https://github.com/aellington89/finance-stack/issues/277)), and that a
pushed tag is a well-formed `vX.Y.Z` matching that version.

Set the version once:

```sh
ver=0.1.4
```

1. **Draft the changelog entries.** The release-notes generator
   ([#170](https://github.com/aellington89/finance-stack/issues/170)) reads the
   commit range, fetches GitHub issue labels, and prints a draft Keep-a-Changelog
   block with issue-linked bullets and a suggested semver bump to **stdout**
   (it does not edit any files):

   ```sh
   cd app
   npm run release:notes -- <prev-tag>..HEAD --changelog
   ```

   Review the output, confirm the suggested bump, and re-sort the bullets into the
   correct `### Added`, `### Changed`, `### Fixed`, or `### Security` subsections
   under `## [Unreleased]` in `CHANGELOG.md`. (`--release` mode emits a GitHub
   Release body instead.)

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
