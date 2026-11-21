#!/usr/bin/env node
// Derives the next version from CHANGELOG.md, rolls the changelog when a release is cut, and
// checks a release tag against the changelog in CI
// (https://github.com/aellington89/dev_process/blob/main/PROCESS.md#8-release). Run it from the
// repository root:
//
//   node scripts/dev-process/release.mjs next [--json]       the next version, and why
//   node scripts/dev-process/release.mjs prepare [<x.y.z>]   Unreleased becomes that version
//   node scripts/dev-process/release.mjs notes <x.y.z>       one version's section, for notes
//   node scripts/dev-process/release.mjs verify <vX.Y.Z>     fails if the tag is a smaller bump
//                                                            than its changelog section needs
//
// The current version is the newest vX.Y.Z tag (0.0.0 before the first release). Each section
// of a release implies a bump, and the largest wins:
//
//   an entry that starts **Breaking:**, or a ### Removed section   major
//   ### Added, ### Changed, or ### Deprecated                      minor
//   ### Fixed, ### Security, or ### Dependencies                   patch
//   ### Internal or ### Deferred, or nothing                       no release
//
// A repository can add floors in .github/release.json: a change under a path raises the bump to
// at least the floor, such as a database schema that migrates every install:
//
//   { "floors": { "app/schemas/": { "bump": "minor", "reason": "a new schema migrates data" } } }
//
// Before 1.0.0, a major is held to a minor: going to 1.0.0 is a decision, not a calculation.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SECTIONS = {
  Added: 'minor',
  Changed: 'minor',
  Deprecated: 'minor',
  Removed: 'major',
  Fixed: 'patch',
  Security: 'patch',
  Dependencies: 'patch',
  Internal: 'none',
  Deferred: 'none',
}
const RANK = { none: 0, patch: 1, minor: 2, major: 3 }
const BREAKING = /^- \*\*breaking:?\*\*:?/i
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/

const format = ({ major, minor, patch }) => `${major}.${minor}.${patch}`
const parse = (text) => {
  const m = SEMVER.exec(String(text).trim())
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null
}
const compare = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch
const ZERO = { major: 0, minor: 0, patch: 0 }

export function bump(version, level) {
  if (level === 'major') return { major: version.major + 1, minor: 0, patch: 0 }
  if (level === 'minor') return { ...version, minor: version.minor + 1, patch: 0 }
  if (level === 'patch') return { ...version, patch: version.patch + 1 }
  return version
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`)
  return result.stdout
}

const releaseTags = (root) =>
  git(root, 'tag', '--list', 'v*').split('\n').map(parse).filter(Boolean).sort(compare)

/** The newest release tag (vX.Y.Z, prereleases ignored), or null before the first release. */
export function currentVersion(root) {
  return releaseTags(root).at(-1) ?? null
}

/** CHANGELOG.md's lines, and where the section under `heading` starts and ends. */
function readSection(root, heading) {
  const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => l.startsWith(`## [${heading}]`))
  if (start === -1) throw new Error(`CHANGELOG.md has no "## [${heading}]" section`)
  const next = lines.findIndex((l, i) => i > start && /^## /.test(l))
  return { lines, start, end: next === -1 ? lines.length : next }
}

/** A section's entries, by subsection. Throws on a subsection the rules don't know. */
function entriesOf(root, heading) {
  const { lines, start, end } = readSection(root, heading)
  const sections = new Map()
  let current = null
  for (const [offset, line] of lines.slice(start + 1, end).entries()) {
    const where = `CHANGELOG.md:${start + 2 + offset}`
    const sub = /^### (.+?)\s*$/.exec(line)
    if (sub) {
      current = sub[1]
      if (!(current in SECTIONS)) {
        throw new Error(
          `${where}: unknown section "### ${current}". Use ${Object.keys(SECTIONS).join(', ')}.`,
        )
      }
      if (!sections.has(current)) sections.set(current, [])
    } else if (/^- /.test(line)) {
      if (!current) {
        throw new Error(
          `${where}: an entry outside a section; put it under ### Added, ### Changed, ` +
            '### Fixed, or another section',
        )
      }
      sections.get(current).push(line)
    }
  }
  return sections
}

/** The Unreleased entries, by section. */
export const unreleased = (root) => entriesOf(root, 'Unreleased')

/** The floors in .github/release.json: { pathPrefix: { bump, reason } }. */
function readFloors(root) {
  const file = join(root, '.github', 'release.json')
  if (!existsSync(file)) return {}
  const floors = JSON.parse(readFileSync(file, 'utf8')).floors ?? {}
  for (const [path, floor] of Object.entries(floors)) {
    if (!(floor.bump in RANK) || floor.bump === 'none') {
      throw new Error(
        `.github/release.json: the floor for "${path}" needs a bump: patch, minor, or major`,
      )
    }
  }
  return floors
}

const firstLine = (entry) => (entry.length > 100 ? `${entry.slice(0, 97)}...` : entry)

/**
 * The bump a set of entries needs, from `base`, with the reasons. `changed` lists the files that
 * changed since `base` was released, for the floors.
 */
function classify(root, sections, base, changed) {
  const reasons = []
  let level = 'none'
  const raise = (to, reason) => {
    reasons.push(`${to}: ${reason}`)
    if (RANK[to] > RANK[level]) level = to
  }
  for (const [name, entries] of sections) {
    if (!entries.length) continue
    const breaking = entries.filter((e) => BREAKING.test(e))
    for (const entry of breaking) raise('major', `a breaking entry: ${firstLine(entry)}`)
    const others = entries.length - breaking.length
    const count = `${others} ${breaking.length ? 'other ' : ''}${others === 1 ? 'entry' : 'entries'}`
    if (SECTIONS[name] === 'none') reasons.push(`none: ${count} under ### ${name}`)
    else if (others) raise(SECTIONS[name], `${count} under ### ${name}`)
  }
  for (const [path, floor] of Object.entries(readFloors(root))) {
    const hits = changed.filter((file) => file.startsWith(path))
    if (hits.length) {
      raise(
        floor.bump,
        `at least ${floor.bump}: ${path} changed${floor.reason ? `, and ${floor.reason}` : ''}`,
      )
    }
  }
  let clamped = false
  if (level === 'major' && base.major === 0) {
    level = 'minor'
    clamped = true
    reasons.push('minor: before 1.0.0, a major is held to a minor; 1.0.0 is your decision')
  }
  return { level, reasons, clamped }
}

const changedSince = (root, tag, to = 'HEAD') =>
  tag ? git(root, 'diff', '--name-only', `${tag}..${to}`).split('\n').filter(Boolean) : []

/** The next version and the reasons for it. bump is null when there's nothing to release. */
export function nextVersion(root) {
  const tagged = currentVersion(root)
  const base = tagged ?? ZERO
  const changed = changedSince(root, tagged && `v${format(tagged)}`)
  const { level, reasons, clamped } = classify(root, unreleased(root), base, changed)
  return {
    current: tagged ? format(tagged) : null,
    next: level === 'none' ? null : format(bump(base, level)),
    bump: level === 'none' ? null : level,
    clamped,
    reasons,
  }
}

/**
 * Checks a release tag against its changelog section: the section exists, and the version is
 * at least the bump its entries need from the previous release. A bigger bump passes with a
 * warning, since it's a decision (such as 1.0.0); a smaller one fails.
 */
export function verify(root, tag, to = 'HEAD') {
  const version = parse(tag)
  if (!version || !/^v/.test(tag)) throw new Error(`"${tag}" isn't a release tag like v1.2.3`)
  const previous =
    releaseTags(root)
      .filter((v) => compare(v, version) < 0)
      .at(-1) ?? null
  const base = previous ?? ZERO
  const changed = changedSince(root, previous && `v${format(previous)}`, to)
  const { level, reasons } = classify(root, entriesOf(root, format(version)), base, changed)
  if (level === 'none') {
    throw new Error(`the [${format(version)}] section has no entries that need a release`)
  }
  const expected = bump(base, level)
  const from = previous ? `v${format(previous)}` : 'the first release'
  const order = compare(version, expected)
  if (order < 0) {
    throw new Error(
      `${tag} is too small a step from ${from}: its changelog needs v${format(expected)} ` +
        `(${level}).\n  - ${reasons.join('\n  - ')}`,
    )
  }
  return {
    tag,
    previous: previous ? format(previous) : null,
    expected: format(expected),
    warning:
      order > 0
        ? `${tag} is a bigger step than the v${format(expected)} its changelog needs`
        : null,
    reasons,
  }
}

const today = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Turns Unreleased into "## [version] - date", keeping an empty Unreleased above it. */
export function prepare(root, version, date = today()) {
  const target = parse(version)
  if (!target) throw new Error(`"${version}" isn't a version like 1.2.3`)
  const tagged = currentVersion(root)
  if (tagged && compare(target, tagged) <= 0) {
    throw new Error(`${format(target)} isn't newer than the current version, ${format(tagged)}`)
  }
  const { lines, start, end } = readSection(root, 'Unreleased')
  const body = lines.slice(start + 1, end)
  if (!body.some((l) => /^- /.test(l))) throw new Error('Unreleased has no entries to release')
  while (body.length && body[0].trim() === '') body.shift()
  const out = [
    ...lines.slice(0, start + 1),
    '',
    `## [${format(target)}] - ${date}`,
    '',
    ...body,
    ...lines.slice(end),
  ]
  // Keep a Changelog's comparison links, when the file has them.
  const link = out.findIndex((l) => /^\[Unreleased\]: \S+\/compare\/\S+\.\.\.HEAD$/.test(l))
  if (link !== -1) {
    const base = out[link].replace(/^\[Unreleased\]: (\S+)\/compare\/.*$/, '$1')
    const from = tagged ? `v${format(tagged)}` : null
    out[link] = `[Unreleased]: ${base}/compare/v${format(target)}...HEAD`
    const added = from
      ? `[${format(target)}]: ${base}/compare/${from}...v${format(target)}`
      : `[${format(target)}]: ${base}/releases/tag/v${format(target)}`
    out.splice(link + 1, 0, added)
  }
  writeFileSync(join(root, 'CHANGELOG.md'), out.join('\n'))
  return format(target)
}

/** The body of one version's section. */
export function notes(root, version) {
  const wanted = parse(version)
  if (!wanted) throw new Error(`"${version}" isn't a version like 1.2.3`)
  const { lines, start, end } = readSection(root, format(wanted))
  return lines
    .slice(start + 1, end)
    .filter((l) => !/^\[[^\]]+\]: /.test(l))
    .join('\n')
    .trim()
}

function main() {
  const [command, arg] = process.argv.slice(2)
  const root = process.cwd()
  try {
    if (command === 'next') {
      const result = nextVersion(root)
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Current: ${result.current ? `v${result.current}` : 'none (no release yet)'}`)
      if (!result.bump)
        console.log('Next:    nothing to release; Unreleased has no user-facing entries')
      else console.log(`Next:    v${result.next} (${result.bump})`)
      for (const reason of result.reasons) console.log(`  - ${reason}`)
    } else if (command === 'prepare') {
      const version = arg ?? nextVersion(root).next
      if (!version) throw new Error('nothing to release: Unreleased has no user-facing entries')
      const written = prepare(root, version)
      console.log(`CHANGELOG.md: Unreleased is now [${written}]. Next, set the version in the`)
      console.log("project's files, if it has any (the Prepare a release fact in CLAUDE.md).")
    } else if (command === 'notes' && arg) {
      console.log(notes(root, arg))
    } else if (command === 'verify' && arg) {
      const result = verify(root, arg)
      if (result.warning) console.log(`warning: ${result.warning}`)
      console.log(
        `release: ${arg} matches its changelog (v${result.expected} from ` +
          `${result.previous ? `v${result.previous}` : 'the first release'}).`,
      )
      for (const reason of result.reasons) console.log(`  - ${reason}`)
    } else {
      console.error(
        'Usage: node scripts/dev-process/release.mjs next [--json] | prepare [<x.y.z>] | ' +
          'notes <x.y.z> | verify <vX.Y.Z>',
      )
      process.exitCode = 2
    }
  } catch (error) {
    console.error(`release: ${error.message}`)
    process.exitCode = 1
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : ''
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) main()
