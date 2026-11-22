#!/usr/bin/env node
// Gives a new issue or pull request what https://github.com/aellington89/dev_process/blob/main/standards/labels.md
// says it opens with, when whoever opened it didn't set it:
//   - the repository's owner as its assignee;
//   - labels from its title (for a pull request, its kind; an Issue PR copies the labels of every
//     issue its title names, except the stage labels);
//   - for a pull request someone else opened, such as Dependabot's, a review request for the
//     owner, which puts it in the owner's pull requests Inbox.
// Anything already set is left alone. Putting a new issue on the repository's GitHub project is
// the GitHub project's own Auto-add workflow's job: a workflow's GITHUB_TOKEN can't reach projects.
//
// In CI, it reads the issues or pull_request event ($GITHUB_EVENT_PATH) and calls the GitHub API
// with $GITHUB_TOKEN:
//   node scripts/dev-process/triage.mjs
// To see what it would do with an event, without calling the API:
//   node scripts/dev-process/triage.mjs --event <file> --dry-run

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { github } from './github.mjs'

const ISSUE_LABELS = [
  [/^Spike: \S/, ['type: spike', 'stage: research']],
  [/^Upgrade: \S/, ['type: upgrade']],
  [/^Chore: \S/, ['type: chore']],
]
const PR_LABELS = [
  [/^Upgrade: \S/, ['type: upgrade']],
  [/^Release: \S/, ['type: release']],
  [/^Docs: \S/, ['documentation']],
  [/^Chore: \S/, ['type: chore']],
]
const ISSUE_PR = /^Issue (#\d+(?:, #\d+)*) - \S/

/**
 * The issues an Issue pull request's title names, in order: `Issue #12 - Tag Filter` (or one of
 * its parts) names 12, and a bundle, `Issue #14, #15 - …`, names 14 and 15. Empty for any other
 * title.
 */
export function linkedIssues(title) {
  const match = title.trim().match(ISSUE_PR)
  return match ? [...match[1].matchAll(/#(\d+)/g)].map((m) => Number(m[1])) : []
}

/** The labels an issue or pull request opens with, from its title. */
export function labelsFor({ pullRequest, title, issueLabels = [] }) {
  const text = title.trim()
  if (pullRequest && ISSUE_PR.test(text)) {
    return [...new Set(issueLabels)].filter((name) => !name.startsWith('stage: '))
  }
  const rules = pullRequest ? PR_LABELS : ISSUE_LABELS
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? []
}

/**
 * What to change on a new issue or pull request:
 * { assignee, labels, reviewer, notes }, where assignee and reviewer are a login or null.
 * `current` is its state now ({ assignees, labels }, as names), which may be newer than the event.
 * `issueLabels` are the labels of the issues an Issue pull request names, together.
 */
export function plan(event, current, issueLabels = []) {
  const pullRequest = Boolean(event.pull_request)
  const item = event.pull_request ?? event.issue
  const owner = event.repository.owner
  const notes = []
  const personal = owner.type !== 'Organization'
  if (!personal) notes.push(`${owner.login} is an organization, so no one is assigned`)

  const assignee = personal && current.assignees.length === 0 ? owner.login : null
  const labels = current.labels.length
    ? []
    : labelsFor({ pullRequest, title: item.title, issueLabels })
  if (!current.labels.length && !labels.length) {
    notes.push(`no labels from its title, so ${pullRequest ? 'add them' : '/triage adds them'}`)
  }
  const author = item.user?.login
  const reviewer = pullRequest && personal && author !== owner.login ? owner.login : null
  return { assignee, labels, reviewer, notes }
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const names = (list = []) => list.map((entry) => entry.login ?? entry.name)

async function main() {
  const eventPath = option('event') ?? process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    console.error('Usage: node scripts/dev-process/triage.mjs [--event <file>] [--dry-run]')
    process.exit(2)
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'))
  const item = event.pull_request ?? event.issue
  if (!item || !event.repository) {
    console.error('triage: the event is neither an issue nor a pull request')
    process.exit(2)
  }
  const kind = event.pull_request ? 'pull request' : 'issue'
  const dryRun = process.argv.includes('--dry-run')
  const repo = event.repository.full_name
  const linked = event.pull_request ? linkedIssues(item.title) : []

  let current = { assignees: names(item.assignees), labels: names(item.labels) }
  let issueLabels = []
  let api
  if (!dryRun) {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
      console.error('triage: GITHUB_TOKEN is not set')
      process.exit(2)
    }
    api = github(token)
    const fresh = await api('GET', `/repos/${repo}/issues/${item.number}`)
    current = { assignees: names(fresh.assignees), labels: names(fresh.labels) }
    for (const number of linked) {
      try {
        issueLabels.push(...names((await api('GET', `/repos/${repo}/issues/${number}`)).labels))
      } catch (error) {
        if (error.status !== 404) throw error
      }
    }
  }

  const { assignee, labels, reviewer, notes } = plan(event, current, issueLabels)
  const issuePath = `/repos/${repo}/issues/${item.number}`
  const actions = []
  if (assignee) {
    actions.push([`assign ${assignee}`, `${issuePath}/assignees`, { assignees: [assignee] }])
  }
  if (labels.length) actions.push([`label ${labels.join(', ')}`, `${issuePath}/labels`, { labels }])
  if (reviewer) {
    const path = `/repos/${repo}/pulls/${item.number}/requested_reviewers`
    actions.push([`request a review from ${reviewer}`, path, { reviewers: [reviewer] }])
  }

  for (const [summary, path, body] of actions) {
    if (!dryRun) await api('POST', path, body)
    console.log(`triage: ${dryRun ? 'would ' : ''}${summary} on ${kind} #${item.number}`)
  }
  for (const note of notes) console.log(`triage: ${note}`)
  if (!actions.length) console.log(`triage: ${kind} #${item.number} already has what it needs`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`triage: ${error.message}`)
    process.exit(1)
  })
}
