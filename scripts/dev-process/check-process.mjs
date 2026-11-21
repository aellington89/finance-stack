#!/usr/bin/env node
// Checks that this repository still meets the dev process contract
// (https://github.com/aellington89/dev_process/blob/main/standards/repositories.md):
//   - every file listed in .dev-process.json is unchanged since dev_process's sync wrote it;
//   - CLAUDE.md imports the shared conventions, and its "## Dev process" table has every fact,
//     each with a real value;
//   - docs/PROCESS.md has every heading of the process notes template, in order, with the
//     template's placeholders replaced;
//   - CHANGELOG.md has an "## [Unreleased]" section.
// Exits 1 and lists every problem. Run it from the repository root:
//
//   node scripts/dev-process/check-process.mjs

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANIFEST = '.dev-process.json'
export const CONVENTIONS_IMPORT = '@~/.claude/dev_process/CONVENTIONS.md'
// The contract. dev_process's self-check keeps these in step with templates/claude-md-section.md
// and templates/process-notes.md, which projects start from.
export const FACTS = [
  'Default branch',
  'Verify',
  'Unit tests',
  'End-to-end tests',
  'Run the app',
  'Format',
  'Next version',
  'Prepare a release',
  'User guide',
  'Roadmap',
]
export const NOTES_HEADINGS = [
  'Differences from the shared process',
  'Definition of Ready additions',
  'Definition of Done additions',
  'Code review additions',
  'Testing',
  'Release',
  'Upgrades',
  'Automation',
  'Repository setup',
  'Terms',
  'Known gaps',
]
const NOTES = 'docs/PROCESS.md'
const HTML_TAGS = new Set(['br', 'details', 'summary', 'sub', 'sup', 'kbd', 'img', 'p', 'b', 'i'])

// Line endings don't count, so a Windows checkout with CRLF files still matches. Nor does the
// version on a workflow's `uses:` line: Dependabot updates those in each repository, and a
// repository may pin them its own way. Any other edit counts.
export const hashContent = (text) =>
  createHash('sha256')
    .update(text.replace(/\r\n/g, '\n').replace(/^(\s*-?\s*uses:\s*[^@\s]+)@.*$/gm, '$1@'))
    .digest('hex')

export function readManifest(root) {
  const path = join(root, MANIFEST)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

const read = (root, path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')

// Lines outside fenced code and HTML comments, which hold examples and guidance.
function contentLines(text) {
  let fenced = false
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => {
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        fenced = !fenced
        return false
      }
      return !fenced
    })
}

function section(lines, heading) {
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l))
  return lines.slice(start + 1, end === -1 ? undefined : end)
}

// Table rows as cell arrays, without the separator row.
const tableRows = (lines) =>
  lines
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|\s*$/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    )

// A value that is nothing but a template placeholder, such as `<command>`.
const isPlaceholder = (value) => /^<[^<>]+>$/.test(value.replace(/`/g, '').trim())

function checkFacts(root, problems) {
  if (!existsSync(join(root, 'CLAUDE.md'))) {
    problems.push('CLAUDE.md: missing; start its Dev process section from the template')
    return
  }
  const lines = contentLines(read(root, 'CLAUDE.md'))
  if (!lines.some((l) => l.trim() === CONVENTIONS_IMPORT)) {
    problems.push(`CLAUDE.md: needs the line "${CONVENTIONS_IMPORT}" to load the conventions`)
  }
  const dev = section(lines, 'Dev process')
  if (dev === null) {
    problems.push('CLAUDE.md: needs a "## Dev process" section (templates/claude-md-section.md)')
    return
  }
  const values = new Map(tableRows(dev).map(([fact, value]) => [fact, value ?? '']))
  for (const fact of FACTS) {
    const value = values.get(fact)
    if (value === undefined) problems.push(`CLAUDE.md: the Dev process table needs a "${fact}" row`)
    else if (!value || isPlaceholder(value)) {
      problems.push(`CLAUDE.md: give the "${fact}" fact a value, or "n/a: <reason>"`)
    }
  }
}

function checkNotes(root, problems) {
  if (!existsSync(join(root, NOTES))) {
    problems.push(`${NOTES}: missing; start it from templates/process-notes.md`)
    return
  }
  const lines = contentLines(read(root, NOTES))
  const present = lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim())
  let last = -1
  for (const heading of NOTES_HEADINGS) {
    const index = present.indexOf(heading)
    if (index === -1) problems.push(`${NOTES}: needs a "## ${heading}" section`)
    else if (index < last) problems.push(`${NOTES}: "## ${heading}" is out of order`)
    else last = index
  }
  const prose = lines.join('\n').replace(/`[^`\n]*`/g, '')
  const leftovers = [...prose.matchAll(/<([a-zA-Z][\w ,.'/-]*)>/g)]
    .map((m) => m[1])
    .filter((inner) => !HTML_TAGS.has(inner.split(' ')[0].toLowerCase()) && !inner.includes('='))
  for (const placeholder of new Set(leftovers)) {
    problems.push(`${NOTES}: replace the template placeholder "<${placeholder}>"`)
  }
}

function checkChangelog(root, problems) {
  if (!existsSync(join(root, 'CHANGELOG.md'))) {
    problems.push('CHANGELOG.md: missing; start it from templates/changelog.md')
  } else if (!/^## \[Unreleased\]\s*$/m.test(read(root, 'CHANGELOG.md'))) {
    problems.push('CHANGELOG.md: needs an "## [Unreleased]" section for the next release')
  }
}

/** Every way the repository at `root` falls short of the contract, as messages. */
export function checkProject(root) {
  const problems = []
  const manifest = readManifest(root)
  if (!manifest) {
    problems.push(`${MANIFEST}: missing; run dev_process's sync`)
    return { problems, manifest }
  }
  for (const [path, hash] of Object.entries(manifest.files ?? {})) {
    if (!existsSync(join(root, path))) {
      problems.push(`${path}: missing; run sync to restore it`)
    } else if (hashContent(read(root, path)) !== hash) {
      problems.push(
        `${path}: edited in place. Make the change in dev_process and sync, or run sync ` +
          'with --force to restore it',
      )
    }
  }
  checkFacts(root, problems)
  checkNotes(root, problems)
  checkChangelog(root, problems)
  return { problems, manifest }
}

function main() {
  const { problems, manifest } = checkProject(process.cwd())
  if (problems.length) {
    console.error(`check-process: ${problems.length} problem(s)\n`)
    for (const problem of problems) console.error(`  ${problem}`)
    console.error(
      '\nSee https://github.com/aellington89/dev_process/blob/main/standards/repositories.md.',
    )
    process.exit(1)
  }
  const count = Object.keys(manifest.files ?? {}).length
  console.log(
    `check-process: ${count} synced files match dev_process ${manifest.version}, and ` +
      'CLAUDE.md, docs/PROCESS.md, and CHANGELOG.md meet the contract.',
  )
}

const invoked = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : ''
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) main()
