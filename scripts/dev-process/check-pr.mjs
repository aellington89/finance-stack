#!/usr/bin/env node
// Checks a pull request's title and description against https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md.
//
// In CI, it reads the pull_request event ($GITHUB_EVENT_PATH):
//   node scripts/dev-process/check-pr.mjs
// Locally, before opening or editing a PR (--author gives the PR's author, for the exemption CI
// applies to a Dependabot PR):
//   node scripts/dev-process/check-pr.mjs --title "<title>" --body-file <file> [--author <login>]
//
// With $GITHUB_TOKEN and $GITHUB_REPOSITORY (set in CI; locally, for example
// GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=<owner>/<repo>), it also reads each issue an
// Issue PR closes, and fails the "Closes" line while a part of its delivery plan before the last
// hasn't merged. Without them, it skips that step and says so.
//
// Exits 1 and lists the problems when the PR doesn't meet the standard.

import { appendFileSync, readFileSync } from 'node:fs'
import {
  closingProblems,
  deliveryPlanRows,
  mergedParts,
  withoutComments,
} from './delivery-plan.mjs'
import { github } from './github.mjs'

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

let title
let body
let author = ''
if (option('title') !== undefined) {
  title = option('title')
  const bodyFile = option('body-file')
  body = bodyFile ? readFileSync(bodyFile, 'utf8') : ''
  author = option('author') ?? ''
} else {
  const eventPath = option('event') ?? process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    console.error(
      'Usage: node scripts/dev-process/check-pr.mjs --title "<title>" --body-file <file> [--author <login>]',
    )
    process.exit(2)
  }
  const pr = JSON.parse(readFileSync(eventPath, 'utf8')).pull_request
  title = pr.title
  body = pr.body ?? ''
  author = pr.user?.login ?? ''
}
title = title.trim()

if (author === 'dependabot[bot]') {
  console.log("check-pr: Dependabot PR; it keeps Dependabot's own title and body.")
  process.exit(0)
}

const errors = []
const warnings = []
// Hidden template guidance doesn't count as content.
const visible = withoutComments(body).replace(/\r\n/g, '\n')
const lines = visible.split('\n')

function section(name) {
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${name}`.toLowerCase())
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

// Content is anything besides blank lines and empty list items left over from a template.
const hasContent = (text) =>
  text.split('\n').some((l) => l.trim() && !/^[-*]\s*(\[[ xX]\])?\s*$/.test(l.trim()))

function requireSections(...names) {
  for (const name of names) {
    const content = section(name)
    if (content === null) errors.push(`the description needs a "## ${name}" section`)
    else if (!hasContent(content)) errors.push(`the "## ${name}" section is empty`)
  }
}

// An Issue PR names every issue it works on in its title: one (`Issue #12 - Tag Filter`, or a
// part, `Issue #12 - Tag Filter: add the tags table`), or a bundle (`Issue #14, #15 - …`). The
// description says, for each one, whether the PR completes it (`Closes #12`) or delivers one
// part of its delivery plan (`Part of #12`).
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi
const PART_OF = /\bpart of\s+#(\d+)/gi

const kinds = [
  {
    name: 'Issue',
    pattern: /^Issue #(\d+)((?:, #\d+)*) - \S/,
    check() {
      const named = [...title.match(/^Issue ([#\d, ]+) - /)[1].matchAll(/#(\d+)/g)].map((m) => m[1])
      const closes = [...visible.matchAll(CLOSES)].map((m) => m[1])
      const parts = [...visible.matchAll(PART_OF)].map((m) => m[1])
      for (const number of named) {
        if (closes.includes(number) && parts.includes(number)) {
          errors.push(`say "Closes #${number}" or "Part of #${number}", not both`)
        } else if (!closes.includes(number) && !parts.includes(number)) {
          errors.push(`the description must say "Closes #${number}" or "Part of #${number}"`)
        }
      }
      for (const [line, numbers] of [
        ['Closes', closes],
        ['Part of', parts],
      ]) {
        for (const number of new Set(numbers)) {
          if (!named.includes(number)) {
            errors.push(
              `"${line} #${number}" names an issue the title doesn't (${named.map((n) => `#${n}`).join(', ')})`,
            )
          }
        }
      }
      if (/^Issue #[\d, #]+ - \d+(\.\d+)+\s*·/.test(title)) {
        warnings.push('leave the roadmap id out of the title: "Issue #<n> - <name>"')
      }
      requireSections('Summary', 'Acceptance criteria', 'Test plan')
      // A part may deliver no criterion of its own ("None in this part: …"); a PR that completes
      // an issue lists every one.
      const criteria = section('Acceptance criteria')
      if (closes.length && criteria !== null && !/^\s*[-*]\s*\[[ xX]\]\s*\S/m.test(criteria)) {
        errors.push('list each acceptance criterion as a "- [ ]" item')
      }
    },
  },
  {
    name: 'Upgrade',
    pattern: /^Upgrade: \S+ \S+ (→|->) \S+/,
    check: () => requireSections('Summary', 'Test plan'),
  },
  {
    name: 'Release',
    pattern: /^Release: v\d+\.\d+\.\d+$/,
    check: () => requireSections('Summary', 'Preflight'),
  },
  { name: 'Docs', pattern: /^Docs: \S/, check: () => requireSections('Summary') },
  { name: 'Chore', pattern: /^Chore: \S/, check: () => requireSections('Summary') },
]

const kind = kinds.find((k) => k.pattern.test(title))
if (kind) {
  kind.check(title.match(kind.pattern))
} else {
  errors.push(
    `the title "${title}" doesn't match a kind of PR. Use "Issue #<n> - <name>" (a part adds ` +
      '": <what this part does>", and a bundle names each issue: "Issue #<n>, #<m> - <summary>"), ' +
      '"Upgrade: <package> <from> → <to>", "Release: v<x.y.z>", "Docs: <summary>", or ' +
      '"Chore: <summary>"',
  )
}

// Template placeholders such as <criterion> or <n> that were never replaced. Code spans and
// real HTML tags are ignored.
const HTML_TAGS = new Set(['br', 'details', 'summary', 'sub', 'sup', 'kbd', 'img', 'p', 'b', 'i'])
const prose = visible.replace(/`[^`\n]*`/g, '')
const leftovers = [...prose.matchAll(/<([a-zA-Z][\w ,.'/-]*)>/g)]
  .map((m) => m[1])
  .filter((inner) => !HTML_TAGS.has(inner.split(' ')[0].toLowerCase()) && !inner.includes('='))
for (const placeholder of new Set(leftovers)) {
  errors.push(`replace the template placeholder "<${placeholder}>"`)
}
if (/^\s*Closes #\s*$/im.test(visible)) errors.push('"Closes #" is missing its issue number')
if (/^\s*Part of #\s*$/im.test(visible)) errors.push('"Part of #" is missing its issue number')

// An issue delivered in parts closes with its last part, once every earlier part has merged
// (standards/pull-requests.md, "Parts"). Only the GitHub API knows what has merged.
const notes = []
const closing =
  kind?.name === 'Issue' ? [...new Set([...visible.matchAll(CLOSES)].map((m) => Number(m[1])))] : []
if (closing.length) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env
  if (!token || !repo) {
    notes.push('skipped the delivery-plan check, which needs GITHUB_TOKEN and GITHUB_REPOSITORY')
  } else {
    const api = github(token)
    for (const number of closing) {
      try {
        const rows = deliveryPlanRows(
          (await api('GET', `/repos/${repo}/issues/${number}`)).body ?? '',
        )
        if (rows.length > 1) {
          errors.push(...closingProblems(number, rows, await mergedParts(api, repo, number)))
        }
      } catch (error) {
        warnings.push(
          `couldn't read #${number}'s delivery plan, so it wasn't checked (${error.status ?? error.message})`,
        )
      }
    }
  }
}

const inActions = process.env.GITHUB_ACTIONS === 'true'
for (const note of notes) console.log(`check-pr: ${note}`)
for (const warning of warnings) {
  console.log(inActions ? `::warning title=PR standards::${warning}` : `warning: ${warning}`)
}
for (const error of errors) {
  console.log(inActions ? `::error title=PR standards::${error}` : `error: ${error}`)
}
if (inActions && process.env.GITHUB_STEP_SUMMARY) {
  const summary = errors.length
    ? ['### PR standards: changes needed', '', ...errors.map((e) => `- ${e}`)]
    : [`### PR standards: ${kind.name} PR, all good`]
  summary.push(
    '',
    'Standard: https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md',
    '',
  )
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'))
}

if (errors.length) {
  console.log(
    `\ncheck-pr: ${errors.length} problem(s). See https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md.`,
  )
  // exitCode, not exit(): exiting while fetch still holds a connection crashes Node on Windows.
  process.exitCode = 1
} else {
  console.log(`check-pr: "${title}" meets the ${kind.name} PR standard.`)
}
