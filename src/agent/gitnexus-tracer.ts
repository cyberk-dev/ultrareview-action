// gitnexus-tracer.ts — orchestrates changed-symbol derivation + parallel fan-out
// Entry: runGitNexusTracer({ filePath, diff, baseRef, headRef, repoPath })
// Cache: module-level Map keyed by "base..head@repoPath"
// Budget: GITNEXUS_TRACER_BUDGET_MS (default 15000ms) via Promise.race

import { isGitNexusAvailable, resolveRepoName } from './gitnexus-client'
import { cypher } from './gitnexus-typed-wrappers'
import { getChangedFiles, getHunkRanges, overlapsAnyHunk } from './gitnexus-diff'
import { fanOutSymbols } from './gitnexus-symbol-fan-out'
import type { CachedSymbol } from './gitnexus-symbol-fan-out'

// -- Env config --

function getBudgetMs(): number {
  return parseInt(process.env['GITNEXUS_TRACER_BUDGET_MS'] ?? '15000', 10)
}
function getMaxSymbolsPerFile(): number {
  return parseInt(process.env['GITNEXUS_MAX_SYMBOLS_PER_FILE'] ?? '10', 10)
}

// -- Public types --

export type CodeNodeKind =
  | 'Function' | 'Method' | 'Class' | 'Interface'
  | 'Struct' | 'Enum' | 'TypeAlias' | 'Const' | 'Trait'

export interface ProcessStep {
  name: string
  file: string
  startLine: number
  endLine: number
  stepIndex: number
  isChangedSymbol: boolean
}

export interface ProcessChain {
  id: string
  label: string
  processType: 'intra_community' | 'cross_community'
  stepCount: number
  steps: ProcessStep[]
}

export interface TracedSymbol {
  name: string
  kind: CodeNodeKind
  startLine: number
  endLine: number
  callers: Array<{ name: string; file: string; line: number }>
  callees: Array<{ name: string; file: string; line: number }>
  impact: { files: number; symbols: number; processes: string[] }
  participatedProcesses: ProcessChain[]
}

export type GitNexusTracerResult = {
  status: 'ok' | 'skipped' | 'partial'
  reason?: string
  filePath: string
  symbols: TracedSymbol[]
}

export interface TracerInput {
  filePath: string
  diff?: string
  baseRef: string
  headRef: string
  repoPath: string
}

// -- File path safety --

const SAFE_PATH_RE = /^[A-Za-z0-9_./$\\ -]+$/

function isSafePath(p: string): boolean { return SAFE_PATH_RE.test(p) }
function escapeCypher(s: string): string { return s.replace(/'/g, "\\'") }

// -- Cypher row parser --

const VALID_KINDS = new Set(['Function','Method','Class','Interface','Struct','Enum','TypeAlias','Const','Trait'])

function parseCypherRow(row: unknown): CachedSymbol | null {
  if (!Array.isArray(row) || row.length < 4) return null
  const [name, kind, startStr, endStr] = row as unknown[]
  if (typeof name !== 'string' || typeof kind !== 'string') return null
  const startLine = typeof startStr === 'number' ? startStr : parseInt(String(startStr), 10)
  const endLine   = typeof endStr   === 'number' ? endStr   : parseInt(String(endStr),   10)
  if (isNaN(startLine) || isNaN(endLine) || !VALID_KINDS.has(kind)) return null
  return { name, kind: kind as CodeNodeKind, startLine, endLine }
}

// -- Per-review changed-symbols cache --

type FileSymbolMap = Map<string, CachedSymbol[]>
// Key: "${base}..${head}@${repoPath}"
const changedSymbolsCache = new Map<string, Promise<FileSymbolMap>>()

async function buildChangedSymbolsMap(
  base: string, head: string, repoPath: string, repo: string,
): Promise<FileSymbolMap> {
  const map: FileSymbolMap = new Map()
  const changedFiles = await getChangedFiles(base, head, repoPath)
  if (changedFiles.length === 0) return map

  await Promise.allSettled(changedFiles.map(async (relFile) => {
    if (!isSafePath(relFile)) return
    const q = [
      `MATCH (n)`,
      `WHERE n.filePath = '${escapeCypher(relFile)}'`,
      `  AND n.startLine IS NOT NULL`,
      `  AND labels(n)[0] IN ['Function','Method','Class','Interface','Struct','Enum','TypeAlias','Const','Trait']`,
      `RETURN n.name AS name, labels(n)[0] AS kind, n.startLine AS startLine, n.endLine AS endLine`,
      `ORDER BY n.startLine`,
    ].join(' ')

    const [rows, hunks] = await Promise.all([
      cypher(repo, q),
      getHunkRanges(base, head, relFile, repoPath),
    ])
    if (hunks.length === 0) return

    const syms: CachedSymbol[] = []
    for (const row of rows) {
      const sym = parseCypherRow(row)
      if (sym && overlapsAnyHunk(sym.startLine, sym.endLine, hunks)) syms.push(sym)
    }
    if (syms.length > 0) map.set(relFile, syms)
  }))

  return map
}

function ensureChangedSymbolsMap(
  base: string, head: string, repoPath: string, repo: string,
): Promise<FileSymbolMap> {
  const key = `${base}..${head}@${repoPath}`
  const hit = changedSymbolsCache.get(key)
  if (hit) return hit
  const p = buildChangedSymbolsMap(base, head, repoPath, repo)
  changedSymbolsCache.set(key, p)
  return p
}

// -- Resolve which key in the map matches the requested filePath --

function findMatchingKey(filePath: string, map: FileSymbolMap): string | undefined {
  for (const key of map.keys()) {
    if (filePath.endsWith(key) || key.endsWith(filePath) || key === filePath) return key
  }
  return undefined
}

// -- Main entry point --

/**
 * Derive changed symbols from git diff + Cypher, then fetch callers/callees/impact/
 * process chains in parallel. Never throws — returns skipped/partial on failure.
 */
export async function runGitNexusTracer(input: TracerInput): Promise<GitNexusTracerResult> {
  const { filePath, baseRef, headRef, repoPath } = input
  const base: GitNexusTracerResult = { status: 'skipped', filePath, symbols: [] }

  try {
    if (!await isGitNexusAvailable(repoPath))
      return { ...base, reason: 'GitNexus not available or repo not indexed' }

    const repo = await resolveRepoName(repoPath)
    if (!repo) return { ...base, reason: 'Could not resolve repo name from repoPath' }

    let timedOut = false
    const budgetMs = getBudgetMs()

    const workPromise = (async (): Promise<GitNexusTracerResult> => {
      const symbolsMap = await ensureChangedSymbolsMap(baseRef, headRef, repoPath, repo)
      if (symbolsMap.size === 0)
        return { status: 'ok', filePath, symbols: [], reason: 'No changed symbols found in diff' }

      const matchedKey = findMatchingKey(filePath, symbolsMap)
      if (!matchedKey) return { status: 'ok', filePath, symbols: [] }

      const capped = (symbolsMap.get(matchedKey) ?? []).slice(0, getMaxSymbolsPerFile())
      const symbols = await fanOutSymbols(capped, matchedKey, repo)
      return { status: 'ok', filePath, symbols }
    })()

    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => { timedOut = true; resolve('timeout') }, budgetMs),
    )

    const winner = await Promise.race([workPromise, timeoutPromise])
    if (winner === 'timeout' || timedOut)
      return { status: 'partial', filePath, symbols: [], reason: `Budget exceeded (${budgetMs}ms)` }

    return winner
  } catch (err) {
    return { status: 'skipped', filePath, symbols: [], reason: err instanceof Error ? err.message : String(err) }
  }
}

/** Clear module-level cache — use in tests or after re-indexing. */
export function clearTracerCache(): void { changedSymbolsCache.clear() }
