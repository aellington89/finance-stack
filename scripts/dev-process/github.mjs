// Calls GitHub's REST API for the scripts that run in a repository's workflows (triage.mjs and
// check-pr.mjs). $GITHUB_API_URL, which GitHub Actions sets, points it at another host.

/**
 * A function that calls the API with `token`: api(method, path, body?) resolves to the parsed
 * JSON. A call that fails throws an Error whose `status` is the HTTP status.
 */
export function github(token) {
  const base = process.env.GITHUB_API_URL ?? 'https://api.github.com'
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const error = new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
      error.status = response.status
      throw error
    }
    return response.json()
  }
}
