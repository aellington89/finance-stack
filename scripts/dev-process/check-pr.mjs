#!/usr/bin/env node
// Checks a pull request's title and description against https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md.
//
// In CI, it reads the pull_request event ($GITHUB_EVENT_PATH):
//   node scripts/dev-process/check-pr.mjs
// Locally, before opening or editing a PR:
//   node scripts/dev-process/check-pr.mjs --title "<title>" --body-file <file>
//
// Exits 1 and lists the problems when the PR doesn't meet the standard.

import { appendFileSync, readFileSync } from 'node:fs'

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
} else {
  const eventPath = option('event') ?? process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    console.error(
      'Usage: node scripts/dev-process/check-pr.mjs --title "<title>" --body-file <file>',
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
const visible = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n')
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

const kinds = [
  {
    name: 'Issue',
    pattern: /^Issue #(\d+) - \S/,
    check([, number]) {
      const closes = [
        ...visible.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi),
      ].map((m) => m[1])
      if (!closes.includes(number)) {
        errors.push(
          closes.length
            ? `"Closes #${closes[0]}" doesn't match the issue in the title (#${number})`
            : `the description must contain "Closes #${number}"`,
        )
      }
      if (/^Issue #\d+ - \d+(\.\d+)+\s*·/.test(title)) {
        warnings.push('leave the roadmap id out of the title: "Issue #<n> - <name>"')
      }
      requireSections('Summary', 'Acceptance criteria', 'Test plan')
      const criteria = section('Acceptance criteria')
      if (criteria !== null && !/^\s*[-*]\s*\[[ xX]\]\s*\S/m.test(criteria)) {
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
    `the title "${title}" doesn't match a kind of PR. Use "Issue #<n> - <name>", ` +
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

const inActions = process.env.GITHUB_ACTIONS === 'true'
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
  process.exit(1)
}
console.log(`check-pr: "${title}" meets the ${kind.name} PR standard.`)
