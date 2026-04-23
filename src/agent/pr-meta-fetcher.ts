// ---------------------------------------------------------------------------
// pr-meta-fetcher.ts — Fetch PR title/body/labels + linked issues via `gh api`.
// One-shot per review; cached. Graceful null on any failure (analyzer proceeds).
// ---------------------------------------------------------------------------

import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkedIssue = {
  number: number
  title: string
  body: string
}

export type PRMeta = {
  title: string
  body: string
  author: string
  labels: string[]
  linkedIssues: LinkedIssue[]
}

export type FetchPRMetaInput = {
  owner: string
  repo: string
  prNumber: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GH_TIMEOUT_MS = 10_000
const MAX_LINKED_ISSUES = 5
const ISSUE_REF_REGEX =
  /(?:fixes|fix|closes|close|resolves|resolve|refs|ref|see|related to)?\s*#(\d+)/gi

// Memoization key: owner/repo#prNumber. Module-level cache.
const cache = new Map<string, PRMeta | null>()
let warnedThisRun = false

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function warnOnce(msg: string): void {
  if (warnedThisRun) return
  warnedThisRun = true
  console.warn(`[pr-meta-fetcher] ${msg}`)
}

async function runGh(args: string[]): Promise<unknown> {
  const { stdout } = await execFile('gh', args, {
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

/**
 * Extract issue numbers referenced in PR body. Captures up to MAX_LINKED_ISSUES
 * unique numbers in order of appearance. Matches `fixes #123`, bare `#456`, etc.
 */
export function extractIssueRefs(body: string): number[] {
  if (!body) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const match of body.matchAll(ISSUE_REF_REGEX)) {
    const numStr = match[1]
    if (!numStr) continue
    const n = parseInt(numStr, 10)
    if (!Number.isFinite(n) || n <= 0) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
    if (out.length >= MAX_LINKED_ISSUES) break
  }
  return out
}

async function fetchIssue(
  owner: string,
  repo: string,
  number: number,
): Promise<LinkedIssue | null> {
  if (!Number.isInteger(number) || number <= 0) return null
  try {
    const data = await runGh([
      'api',
      `repos/${owner}/${repo}/issues/${number}`,
      '--jq',
      '{number, title, body}',
    ]) as { number?: number; title?: string; body?: string | null }
    if (typeof data.number !== 'number') return null
    return {
      number: data.number,
      title: typeof data.title === 'string' ? data.title : '',
      body: typeof data.body === 'string' ? data.body : '',
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Entry: fetchPRMeta
// ---------------------------------------------------------------------------

/**
 * Fetch PR meta + linked issues. Memoized per (owner, repo, prNumber).
 * Returns null and logs a one-time warning when `gh` is missing/unauthenticated
 * or the API fails — caller should proceed without PR meta.
 */
export async function fetchPRMeta(input: FetchPRMetaInput): Promise<PRMeta | null> {
  const { owner, repo, prNumber } = input
  if (!owner || !repo || !Number.isInteger(prNumber) || prNumber <= 0) return null

  const key = `${owner}/${repo}#${prNumber}`
  if (cache.has(key)) return cache.get(key) ?? null

  let pr: { title?: string; body?: string | null; user?: { login?: string }; labels?: Array<{ name?: string } | string> }
  try {
    pr = await runGh([
      'api',
      `repos/${owner}/${repo}/pulls/${prNumber}`,
      '--jq',
      '{title, body, user: {login: .user.login}, labels: [.labels[]?.name]}',
    ]) as typeof pr
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnOnce(`gh api failed for ${key}: ${msg}`)
    cache.set(key, null)
    return null
  }

  const title = typeof pr.title === 'string' ? pr.title : ''
  const body = typeof pr.body === 'string' ? pr.body : ''
  const author = pr.user?.login ?? ''
  const labels = Array.isArray(pr.labels)
    ? pr.labels.map((l) => (typeof l === 'string' ? l : (l?.name ?? ''))).filter(Boolean)
    : []

  const issueNumbers = extractIssueRefs(body)
  const linkedIssues: LinkedIssue[] = []
  // Sequential fetches to keep rate-limit footprint tiny (≤5 calls).
  for (const n of issueNumbers) {
    const issue = await fetchIssue(owner, repo, n)
    if (issue) linkedIssues.push(issue)
  }

  const meta: PRMeta = { title, body, author, labels, linkedIssues }
  cache.set(key, meta)
  return meta
}

// ---------------------------------------------------------------------------
// resolveCurrentPR — derive {owner, repo, prNumber} from env or `gh pr view`.
// ---------------------------------------------------------------------------

export async function resolveCurrentPR(): Promise<FetchPRMetaInput | null> {
  const repoEnv = process.env['GITHUB_REPOSITORY'] // owner/repo
  const prEnv = process.env['PR_NUMBER'] ?? process.env['GITHUB_PR_NUMBER']

  if (repoEnv && prEnv) {
    const [owner, repo] = repoEnv.split('/')
    const prNumber = parseInt(prEnv, 10)
    if (owner && repo && Number.isInteger(prNumber) && prNumber > 0) {
      return { owner, repo, prNumber }
    }
  }

  // Fallback: gh pr view — only works when run inside a PR checkout context.
  try {
    const data = await runGh([
      'pr',
      'view',
      '--json',
      'number,headRepository,headRepositoryOwner',
    ]) as {
      number?: number
      headRepository?: { name?: string }
      headRepositoryOwner?: { login?: string }
    }
    const owner = data.headRepositoryOwner?.login
    const repo = data.headRepository?.name
    const prNumber = data.number
    if (owner && repo && Number.isInteger(prNumber) && (prNumber as number) > 0) {
      return { owner, repo, prNumber: prNumber as number }
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Test/internal helpers — clear caches between tests.
// ---------------------------------------------------------------------------

export function _clearPRMetaCache(): void {
  cache.clear()
  warnedThisRun = false
}
