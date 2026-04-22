/**
 * Low-level GitNexus CLI wrapper. Errors map to GitNexusError.code: NOT_INSTALLED | NOT_INDEXED |
 * TIMEOUT | PARSE_ERROR | EXIT_NONZERO | MULTI_REPO_AMBIGUOUS. Supports graceful skip via env flag.
 */

// GitNexus CLI client — low-level subprocess wrapper + health check
// Env: GITNEXUS_ENABLED (default true), GITNEXUS_BIN (default "gitnexus"), GITNEXUS_TIMEOUT_MS (default 30000)
// Typed wrappers (cypher/context/impact): gitnexus-typed-wrappers.ts

import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

// -- Env config: read at call-time so tests can override process.env --

export function isEnabled(): boolean { return (process.env.GITNEXUS_ENABLED ?? 'true') !== 'false' }
export function getBinName(): string { return process.env.GITNEXUS_BIN ?? 'gitnexus' }
export function getTimeoutMs(): number { return parseInt(process.env.GITNEXUS_TIMEOUT_MS ?? '30000', 10) }

// -- Error types --

export type ErrorCode =
  | 'NOT_INSTALLED'
  | 'NOT_INDEXED'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'EXIT_NONZERO'
  | 'MULTI_REPO_AMBIGUOUS'

export class GitNexusError extends Error {
  code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'GitNexusError'
    this.code = code
  }
}

// -- Per-process caches --

/** Map<repoPath, repoName | null> — null = not indexed */
const repoNameCache = new Map<string, string | null>()
const availabilityCache = new Map<string, boolean>()

// -- `gitnexus list` text parser --

interface ListedRepo { name: string; path: string }

/**
 * Parse human-readable `gitnexus list` output.
 * 2-space indent = repo name; 4-space indent = property line.
 */
function parseListOutput(stdout: string): ListedRepo[] {
  const repos: ListedRepo[] = []
  let currentName: string | null = null
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const indent = line.length - line.trimStart().length
    if (indent === 2 && !trimmed.startsWith('Indexed')) {
      currentName = trimmed
    } else if (indent === 4 && currentName && trimmed.startsWith('Path:')) {
      repos.push({ name: currentName, path: trimmed.replace(/^Path:\s*/, '').trim() })
    }
  }
  return repos
}

// -- Binary detection --

/** Returns resolved gitnexus binary path, or null if missing/disabled. */
export function getGitNexusBin(): string | null {
  if (!isEnabled()) return null
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    const result = execFileSync('which', [getBinName()], { encoding: 'utf8', stdio: 'pipe' })
    return result.trim() || null
  } catch { return null }
}

// -- Core subprocess runner --

export interface RunOpts { cwd?: string; timeout?: number }

/**
 * Spawn gitnexus with array args, parse stdout as JSON.
 * Throws GitNexusError on all failure modes.
 * Uses array args only — no shell interpolation.
 */
export async function runGitNexusJSON(cmd: string, args: string[], opts: RunOpts = {}): Promise<unknown> {
  const bin = getGitNexusBin()
  if (!bin) throw new GitNexusError('NOT_INSTALLED', 'gitnexus binary not found')

  const timeout = opts.timeout ?? getTimeoutMs()
  let stdout: string
  try {
    const result = await execFile(bin, [cmd, ...args], { cwd: opts.cwd, timeout, maxBuffer: 10 * 1024 * 1024 })
    stdout = result.stdout
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      const e = err as { killed?: boolean; code?: string | number; stderr?: string; stdout?: string }
      if (e.code === 'ENOENT') throw new GitNexusError('NOT_INSTALLED', `gitnexus not found at '${bin}'`)
      if (e.killed) throw new GitNexusError('TIMEOUT', `gitnexus ${cmd} timed out after ${timeout}ms`)
      const stderr = (e.stderr ?? '') as string
      if (stderr.includes('Multiple repositories indexed'))
        throw new GitNexusError('MULTI_REPO_AMBIGUOUS', 'Multiple repos indexed; pass --repo')
      // gitnexus may write valid JSON to stdout even on non-zero exit
      const out = (e.stdout ?? '') as string
      if (out.trim()) stdout = out
      else throw new GitNexusError('EXIT_NONZERO', `gitnexus ${cmd} exited non-zero: ${stderr}`.slice(0, 300))
    } else {
      throw new GitNexusError('EXIT_NONZERO', `gitnexus ${cmd} failed: ${String(err)}`)
    }
  }

  const raw = stdout.trim()
  if (!raw) throw new GitNexusError('PARSE_ERROR', `gitnexus ${cmd} returned empty output`)
  try {
    return JSON.parse(raw)
  } catch {
    throw new GitNexusError('PARSE_ERROR', `gitnexus ${cmd} output not JSON: ${raw.slice(0, 200)}`)
  }
}

// -- Repo resolution --

/**
 * Resolve repo name from absolute path via `gitnexus list`.
 * Returns null if path not indexed. Cached for process lifetime.
 */
export async function resolveRepoName(repoPath: string): Promise<string | null> {
  if (repoNameCache.has(repoPath)) return repoNameCache.get(repoPath) ?? null
  const bin = getGitNexusBin()
  if (!bin) { repoNameCache.set(repoPath, null); return null }
  try {
    const result = await execFile(bin, ['list'], { timeout: getTimeoutMs() })
    for (const r of parseListOutput(result.stdout)) {
      if (!repoNameCache.has(r.path)) repoNameCache.set(r.path, r.name)
    }
    if (!repoNameCache.has(repoPath)) repoNameCache.set(repoPath, null)
    return repoNameCache.get(repoPath) ?? null
  } catch {
    repoNameCache.set(repoPath, null)
    return null
  }
}

// -- Availability check --

/**
 * Returns true iff binary exists AND repoPath is indexed.
 * Cached per repoPath for process lifetime. Never throws.
 */
export async function isGitNexusAvailable(repoPath: string): Promise<boolean> {
  if (!isEnabled()) return false
  if (availabilityCache.has(repoPath)) return availabilityCache.get(repoPath) ?? false
  if (!getGitNexusBin()) { availabilityCache.set(repoPath, false); return false }
  try {
    const available = (await resolveRepoName(repoPath)) !== null
    availabilityCache.set(repoPath, available)
    return available
  } catch {
    availabilityCache.set(repoPath, false)
    return false
  }
}

/** Clear per-process caches — use in tests or after re-indexing. */
export function clearGitNexusCache(): void {
  repoNameCache.clear()
  availabilityCache.clear()
}
