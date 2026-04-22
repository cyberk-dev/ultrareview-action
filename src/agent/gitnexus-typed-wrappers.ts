// ---------------------------------------------------------------------------
// GitNexus typed wrappers — high-level accessors for cypher/context/impact
// All functions swallow errors and return empty sentinels (no throw).
// Low-level core: see gitnexus-client.ts
//
// Phase 4 note: routeMap() and shapeCheck() are DEFERRED — gitnexus CLI does
// not expose route_map / shape_check commands (MCP-only). Stubs return empty
// sentinels and are annotated NOT_SUPPORTED. Track in .changeset/phase-04-defer.md.
// ---------------------------------------------------------------------------

import { isEnabled, runGitNexusJSON } from './gitnexus-client'

// ---------------------------------------------------------------------------
// Cypher
// ---------------------------------------------------------------------------

/**
 * Parse cypher output — three possible shapes:
 *   `[]`                               empty result set
 *   `{"markdown":"| ... |","row_count":N}` table result
 *   raw JSON object                    other commands (pass-through)
 */
function parseCypherOutput(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r['markdown'] === 'string') {
      const lines = r['markdown'].split('\n').filter(l => l.startsWith('|'))
      if (lines.length <= 2) return [] // header + separator only
      return lines.slice(2).map(line => {
        const cells = line.split('|')
          .filter((_, i) => i > 0 && i < line.split('|').length - 1)
          .map(c => c.trim())
        return cells.length === 1 ? (cells[0] ?? '') : cells
      })
    }
  }
  return []
}

/**
 * Execute a Cypher query against the GitNexus knowledge graph.
 * Returns parsed row values; returns [] on any error.
 * Note: `gitnexus cypher` does NOT accept `--json` flag — output is always
 * `{"markdown": "...", "row_count": N}` for table queries or `[]` for empty.
 */
export async function cypher(repo: string, query: string): Promise<unknown[]> {
  if (!isEnabled()) return []
  try {
    const raw = await runGitNexusJSON('cypher', [query, '--repo', repo])
    return parseCypherOutput(raw)
  } catch (err) {
    console.warn('[gitnexus] cypher error:', err instanceof Error ? err.message : err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ContextResult {
  callers: unknown[]
  callees: unknown[]
  processes: unknown[]
}

const EMPTY_CONTEXT: ContextResult = { callers: [], callees: [], processes: [] }

/**
 * Get 360-degree symbol context (callers, callees, processes).
 * Returns empty sentinels on error or when symbol not found.
 */
export async function context(
  repo: string,
  name: string,
  filePath?: string,
): Promise<ContextResult> {
  if (!isEnabled()) return EMPTY_CONTEXT
  try {
    const args = [name, '--repo', repo]
    if (filePath) args.push('--file', filePath)
    const raw = await runGitNexusJSON('context', args)
    if (!raw || typeof raw !== 'object' || 'error' in (raw as object)) return EMPTY_CONTEXT
    const r = raw as Record<string, unknown>
    const incoming = r['incoming'] as Record<string, unknown> | undefined
    const outgoing = r['outgoing'] as Record<string, unknown> | undefined
    return {
      callers: Array.isArray(incoming?.['calls']) ? (incoming['calls'] as unknown[]) : [],
      callees: Array.isArray(outgoing?.['calls']) ? (outgoing['calls'] as unknown[]) : [],
      processes: Array.isArray(r['processes']) ? (r['processes'] as unknown[]) : [],
    }
  } catch (err) {
    console.warn('[gitnexus] context error:', err instanceof Error ? err.message : err)
    return EMPTY_CONTEXT
  }
}

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

export interface ImpactResult {
  files: unknown[]
  symbols: unknown[]
  processes: unknown[]
}

const EMPTY_IMPACT: ImpactResult = { files: [], symbols: [], processes: [] }

/**
 * Get blast-radius analysis for a symbol.
 * Flattens byDepth into a flat symbol list for phase 2 consumption.
 * Returns empty sentinels on error.
 */
export async function impact(
  repo: string,
  target: string,
  filePath?: string,
): Promise<ImpactResult> {
  if (!isEnabled()) return EMPTY_IMPACT
  try {
    const args = [target, '--repo', repo]
    if (filePath) args.push('--file', filePath)
    const raw = await runGitNexusJSON('impact', args)
    if (!raw || typeof raw !== 'object') return EMPTY_IMPACT
    const r = raw as Record<string, unknown>
    const byDepth = r['byDepth'] as Record<string, unknown[]> | undefined
    return {
      files: [],
      symbols: byDepth ? Object.values(byDepth).flat() : [],
      processes: Array.isArray(r['affected_processes']) ? (r['affected_processes'] as unknown[]) : [],
    }
  } catch (err) {
    console.warn('[gitnexus] impact error:', err instanceof Error ? err.message : err)
    return EMPTY_IMPACT
  }
}

// ---------------------------------------------------------------------------
// Query — process/flow search
// ---------------------------------------------------------------------------

export interface QueryProcess {
  id: string
  name: string
  process_type: string
  entry_function: string
  terminal_function: string
  step_count: number
}

export interface QueryProcessSymbol {
  id: string
  process_id: string
  name: string
  file: string
  start_line: number
  end_line: number
  step_index: number
}

export interface QueryDefinition {
  id: string
  name: string
  kind: string
  file: string
  start_line: number
  end_line: number
}

export interface QueryResult {
  processes: QueryProcess[]
  process_symbols: QueryProcessSymbol[]
  definitions: QueryDefinition[]
}

const EMPTY_QUERY: QueryResult = { processes: [], process_symbols: [], definitions: [] }

/**
 * Search for processes/flows related to a concept or symbol name.
 * Returns processes[], process_symbols[] (pre-sorted by step_index), definitions[].
 * Returns empty sentinels on any error.
 */
export async function query(
  repo: string,
  concept: string,
  contextText?: string,
  limit = 5,
): Promise<QueryResult> {
  if (!isEnabled()) return EMPTY_QUERY
  try {
    const args = [concept, '--repo', repo, '--limit', String(limit)]
    if (contextText) args.push('--context', contextText)
    const raw = await runGitNexusJSON('query', args)
    if (!raw || typeof raw !== 'object') return EMPTY_QUERY
    const r = raw as Record<string, unknown>
    return {
      processes: Array.isArray(r['processes']) ? (r['processes'] as QueryProcess[]) : [],
      process_symbols: Array.isArray(r['process_symbols'])
        ? (r['process_symbols'] as QueryProcessSymbol[])
        : [],
      definitions: Array.isArray(r['definitions']) ? (r['definitions'] as QueryDefinition[]) : [],
    }
  } catch (err) {
    console.warn('[gitnexus] query error:', err instanceof Error ? err.message : err)
    return EMPTY_QUERY
  }
}

// ---------------------------------------------------------------------------
// Route map — NOT_SUPPORTED (CLI lacks route_map command; MCP-only)
// DEFERRED: see .changeset/phase-04-defer.md
// ---------------------------------------------------------------------------

export interface RouteMapEntry {
  method: string  // e.g. 'GET', 'POST'
  path: string    // e.g. '/api/users/:id'
  handler?: string
}

/**
 * Fetch route map for a repo.
 * DEFERRED — gitnexus CLI does not expose route_map (MCP-only tool).
 * Always returns [] until promoted in a future phase.
 */
export async function routeMap(_repo: string): Promise<RouteMapEntry[]> {
  // NOT_SUPPORTED: CLI lacks `gitnexus route_map`. Promote when MCP path added.
  return []
}

// ---------------------------------------------------------------------------
// Shape check — NOT_SUPPORTED (CLI lacks shape_check command; MCP-only)
// DEFERRED: see .changeset/phase-04-defer.md
// ---------------------------------------------------------------------------

export type ShapeDriftKind = 'add' | 'remove' | 'modify'

export interface ShapeDriftEntry {
  kind: ShapeDriftKind
  field: string
  note: string
}

/**
 * Compute shape drift between two refs for a repo.
 * DEFERRED — gitnexus CLI does not expose shape_check (MCP-only tool).
 * Always returns [] until promoted in a future phase.
 */
export async function shapeCheck(
  _repo: string,
  _baseRef: string,
  _headRef: string,
): Promise<ShapeDriftEntry[]> {
  // NOT_SUPPORTED: CLI lacks `gitnexus shape_check`. Promote when MCP path added.
  return []
}
