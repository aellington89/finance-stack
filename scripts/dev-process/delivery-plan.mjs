// Reads an issue's delivery plan (the table under "## Delivery plan" in its spec,
// https://github.com/aellington89/dev_process/blob/main/templates/issue-spec.md) and counts the
// parts of it that have merged, so check-pr.mjs can hold a "Closes" line until the last part
// (https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md#parts).

const PART_OF = /\bpart of\s+#(\d+)/gi

/**
 * The text without its HTML comments (template guidance, hidden from readers). Removing a comment
 * can join the text around it into a new one ("<!-<!-- x -->-"), so it scans again until none
 * is left; a "<!--" with no closing "-->" stays, as it renders as text.
 */
export function withoutComments(text) {
  let current = text
  for (;;) {
    let out = ''
    let from = 0
    for (;;) {
      const open = current.indexOf('<!--', from)
      const close = open === -1 ? -1 : current.indexOf('-->', open + 4)
      if (close === -1) break
      out += current.slice(from, open)
      from = close + 3
    }
    out += current.slice(from)
    if (out === current) return out
    current = out
  }
}

const visible = (text) => withoutComments(text).replace(/\r\n/g, '\n')
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

/**
 * The "Pull request" cell of each row of the delivery plan in an issue's body, in order, or none
 * when it has no plan. A row that still holds the template's placeholder doesn't count.
 */
export function deliveryPlanRows(body) {
  const lines = visible(body).split('\n')
  const start = lines.findIndex((line) => /^##\s+delivery plan\s*$/i.test(line.trim()))
  if (start === -1) return []
  const table = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break
    if (line.trim().startsWith('|')) table.push(cells(line))
    else if (table.length) break
  }
  if (table.length < 2) return []
  const [header, ...rows] = table
  const named = header.findIndex((cell) => /^pull request$/i.test(cell))
  const column = named === -1 ? Math.min(1, header.length - 1) : named
  return rows
    .filter((row) => !row.every((cell) => /^:?-*:?$/.test(cell)))
    .map((row) => row[column] ?? '')
    .filter((cell) => cell && !/^<[^>]*>$/.test(cell))
}

/**
 * What's wrong with a "Closes #<number>" line, given the issue's delivery plan rows and how many
 * merged pull requests say "Part of #<number>": every part before the last must have merged.
 */
export function closingProblems(number, rows, merged) {
  const before = rows.length - 1
  if (before < 1 || merged >= before) return []
  // A row can be a paragraph; its first clause names it.
  const short = (row) => {
    const clause = row.split(/[.:;]\s/)[0].replace(/[.:;]$/, '')
    return clause.length > 60 ? `${clause.slice(0, 59).trimEnd()}…` : clause
  }
  const waiting = rows.slice(merged, before).map((row, i) => `${merged + i + 1} (${short(row)})`)
  const which =
    waiting.length === 1 ? `part ${waiting[0]} hasn't` : `parts ${waiting.join(', ')} haven't`
  return [
    `"Closes #${number}" is too early: ${which} merged, and only the last of the ` +
      `${rows.length} parts in #${number}'s delivery plan closes it. Say "Part of #${number}", ` +
      `or update the plan in #${number} if it changed`,
  ]
}

/**
 * How many merged pull requests in `repo` say "Part of #<number>", from the issue's timeline,
 * where each one that mentions the issue appears as a cross-reference. `api` is github(token).
 */
export async function mergedParts(api, repo, number) {
  const parts = new Set()
  for (let page = 1; ; page++) {
    const path = `/repos/${repo}/issues/${number}/timeline?per_page=100&page=${page}`
    const events = await api('GET', path)
    for (const event of events) {
      const source = event.event === 'cross-referenced' ? event.source?.issue : null
      if (!source?.pull_request?.merged_at) continue
      if (!source.repository_url?.toLowerCase().endsWith(`/repos/${repo}`.toLowerCase())) continue
      const says = [...visible(source.body ?? '').matchAll(PART_OF)].map((m) => Number(m[1]))
      if (says.includes(number)) parts.add(source.number)
    }
    if (events.length < 100) return parts.size
  }
}
