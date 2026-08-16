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
which runs the version/tag-consistency gate, builds the stamped Docker image,
verifies `/api/health`, and publishes the Release — procedure steps 4–5 are
handled by CI.

To manually create or refresh a release body (local fallback):

```sh
gh release create v0.1.4 --title v0.1.4 --notes-file <changelog-section.md>
# or, to update an existing release:
gh release edit v0.1.4 --notes-file <changelog-section.md>
```

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

4. **Slice the release body** and **publish the Release** — handled automatically
   by `.github/workflows/release.yml` when the tag is pushed (step 3). The
   workflow slices the `CHANGELOG.md` section, verifies the stamped Docker image,
   and calls `gh release create`. Monitor the run at
   `https://github.com/aellington89/finance-stack/actions`.

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
