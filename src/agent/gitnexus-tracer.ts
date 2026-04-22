/**
 * Derives changed symbols from git diff + GitNexus Cypher; fetches callers, callees, impact,
 * and end-to-end process chains. Returns `{status: 'skipped'}` on any error for graceful degradation.
 */

// gitnexus-tracer.ts — orchestrates changed-symbol derivation + parallel fan-out
// Entry: runGitNexusTracer({ filePath, diff, baseRef, headRef, repoPath })
// Cache: module-level Map keyed by "base..head@repoPath"
// Budget: GITNEXUS_TRACER_BUDGET_MS (default 45000ms) via Promise.race

import { isGitNexusAvailable, resolveRepoName } from './gitnexus-client'
import { cypher } from './gitnexus-typed-wrappers'
import type { RouteMapEntry, ShapeDriftEntry } from './gitnexus-typed-wrappers'
import { getChangedFiles, getHunkRanges, overlapsAnyHunk } from './gitnexus-diff'
import { fanOutSymbols } from './gitnexus-symbol-fan-out'
import type { CachedSymbol } from './gitnexus-symbol-fan-out'

// -- Env config --

function getBudgetMs(): number {
  return parseInt(process.env['GITNEXUS_TRACER_BUDGET_MS'] ?? '45000', 10)
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
  // Phase-4 extra signals — populated only when heuristic triggers.
  // DEFERRED: routeMap/shapeCheck CLI commands not available; fields always
  // undefined until MCP-backed path is added in a future phase.
  routeImpact?: Array<{ method: string; path: string }>
  shapeDrift?: Array<{ kind: 'add' | 'remove' | 'modify'; field: string; note: string }>
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

// ---------------------------------------------------------------------------
// Phase-4 extra-signal decision functions
// DEFERRED: actual fetch is no-op — CLI lacks route_map/shape_check commands.
// Heuristic functions are implemented so they can be wired up once MCP path exists.
// ---------------------------------------------------------------------------

const ROUTE_PATH_RE = /(routes|api|controllers|handlers|endpoints)/i

/**
 * Returns true when any changed file path matches a route/API heuristic.
 * Triggers route_map fetch (deferred — CLI not supported yet).
 */
export function shouldFetchRouteMap(changedFiles: string[]): boolean {
  return changedFiles.some(f => ROUTE_PATH_RE.test(f))
}

const SHAPE_KEYWORD_RE = /\b(interface|type|class|schema|struct)\b/

/**
 * Returns true when the unified diff contains schema/type-definition keywords.
 * Triggers shape_check fetch (deferred — CLI not supported yet).
 */
export function shouldFetchShapeCheck(diff: string): boolean {
  return SHAPE_KEYWORD_RE.test(diff)
}

// Cache keyed by "${base}..${head}@${repoPath}" — same pattern as changedSymbolsCache.
// Currently holds empty sentinels; will hold real data once CLI commands are available.
const routeMapCache = new Map<string, Promise<RouteMapEntry[]>>()
const shapeDriftCache = new Map<string, Promise<ShapeDriftEntry[]>>()

/**
 * Fetch route map (memoized per base+head+repo). Graceful no-op — DEFERRED.
 * Emits a single warning per run when triggered so operators know the feature is pending.
 */
async function fetchRouteMapOnce(key: string, _repo: string): Promise<RouteMapEntry[]> {
  const hit = routeMapCache.get(key)
  if (hit) return hit
  const p = (async (): Promise<RouteMapEntry[]> => {
    // DEFERRED — gitnexus CLI has no route_map command (MCP-only).
    // Replace body with: `return routeMap(_repo)` once CLI support is added.
    console.warn('[gitnexus] route_map triggered but DEFERRED (CLI lacks command; use MCP in future)')
    return []
  })()
  routeMapCache.set(key, p)
  return p
}

/**
 * Fetch shape drift (memoized per base+head+repo). Graceful no-op — DEFERRED.
 * Emits a single warning per run when triggered.
 */
async function fetchShapeDriftOnce(key: string, _repo: string, _base: string, _head: string): Promise<ShapeDriftEntry[]> {
  const hit = shapeDriftCache.get(key)
  if (hit) return hit
  const p = (async (): Promise<ShapeDriftEntry[]> => {
    // DEFERRED — gitnexus CLI has no shape_check command (MCP-only).
    // Replace body with: `return shapeCheck(_repo, _base, _head)` once available.
    console.warn('[gitnexus] shape_check triggered but DEFERRED (CLI lacks command; use MCP in future)')
    return []
  })()
  shapeDriftCache.set(key, p)
  return p
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
      const extraKey = `${baseRef}..${headRef}@${repoPath}`
      const changedFilesForSignal = Array.from(symbolsMap.keys())
      const diff = input.diff ?? ''

      // Decide which extra signals to fetch (conditional, once per run)
      const fetchRoute = shouldFetchRouteMap(changedFilesForSignal)
      const fetchShape = shouldFetchShapeCheck(diff)

      const [symbols, routeEntries, shapeEntries] = await Promise.all([
        fanOutSymbols(capped, matchedKey, repo),
        fetchRoute ? fetchRouteMapOnce(extraKey, repo) : Promise.resolve([]),
        fetchShape ? fetchShapeDriftOnce(extraKey, repo, baseRef, headRef) : Promise.resolve([]),
      ])

      // Merge extra signals into each symbol (deferred: both arrays are always [])
      if (routeEntries.length > 0 || shapeEntries.length > 0) {
        for (const sym of symbols) {
          if (routeEntries.length > 0) sym.routeImpact = routeEntries.map(r => ({ method: r.method, path: r.path }))
          if (shapeEntries.length > 0) sym.shapeDrift = shapeEntries.map(s => ({ kind: s.kind, field: s.field, note: s.note }))
        }
      }

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
export function clearTracerCache(): void {
  changedSymbolsCache.clear()
  routeMapCache.clear()
  shapeDriftCache.clear()
}
