// ---------------------------------------------------------------------------
// gitnexus-symbol-fan-out.ts — per-symbol parallel context/impact/process fan-out
// Called by gitnexus-tracer.ts to keep that file under 200 LOC.
// ---------------------------------------------------------------------------

import { context, impact } from './gitnexus-typed-wrappers'
import { resolveParticipatedProcesses } from './gitnexus-process-resolver'
import type { CodeNodeKind, ProcessChain, TracedSymbol } from './gitnexus-tracer'

// -- Type for internal symbol (from Cypher cache) --

export interface CachedSymbol {
  name: string
  kind: CodeNodeKind
  startLine: number
  endLine: number
}

// -- Caller/callee extraction --

function extractRefs(refs: unknown[]): Array<{ name: string; file: string; line: number }> {
  return refs
    .map((c) => {
      if (!c || typeof c !== 'object') return null
      const r = c as Record<string, unknown>
      return {
        name: typeof r['name'] === 'string' ? r['name'] : '',
        file:
          typeof r['file'] === 'string'
            ? r['file']
            : typeof r['filePath'] === 'string'
              ? r['filePath']
              : '',
        line:
          typeof r['line'] === 'number'
            ? r['line']
            : typeof r['startLine'] === 'number'
              ? r['startLine']
              : 0,
      }
    })
    .filter((c): c is { name: string; file: string; line: number } => c !== null && c.name !== '')
}

// -- Impact extraction --

function extractImpact(imp: {
  files: unknown[]
  symbols: unknown[]
  processes: unknown[]
}): { files: number; symbols: number; processes: string[] } {
  const processes = imp.processes
    .map((p) => {
      if (typeof p === 'string') return p
      if (p && typeof p === 'object') {
        const r = p as Record<string, unknown>
        return typeof r['name'] === 'string' ? r['name'] : ''
      }
      return ''
    })
    .filter(Boolean)
  return { files: imp.files.length, symbols: imp.symbols.length, processes }
}

// -- Public: fan-out one file's changed symbols in parallel --

/**
 * For each CachedSymbol, runs context + impact + participatedProcesses concurrently.
 * Returns array of TracedSymbol; silently drops any symbol that errors.
 */
export async function fanOutSymbols(
  symbols: CachedSymbol[],
  relFile: string,
  repo: string,
): Promise<TracedSymbol[]> {
  const moduleHint = (() => {
    const parts = relFile.split('/')
    return parts.length > 1 ? parts.slice(0, -1).join('/') : undefined
  })()

  const settled = await Promise.allSettled(
    symbols.map(async (sym): Promise<TracedSymbol> => {
      const [ctx, imp, procs] = await Promise.allSettled([
        context(repo, sym.name, relFile),
        impact(repo, sym.name, relFile),
        resolveParticipatedProcesses(repo, sym.name, undefined, moduleHint),
      ])

      const ctxVal =
        ctx.status === 'fulfilled' ? ctx.value : { callers: [], callees: [], processes: [] }
      const impVal =
        imp.status === 'fulfilled' ? imp.value : { files: [], symbols: [], processes: [] }
      const procsVal: ProcessChain[] = procs.status === 'fulfilled' ? procs.value : []

      return {
        name: sym.name,
        kind: sym.kind,
        startLine: sym.startLine,
        endLine: sym.endLine,
        callers: extractRefs(ctxVal.callers),
        callees: extractRefs(ctxVal.callees),
        impact: extractImpact(impVal),
        participatedProcesses: procsVal,
      }
    }),
  )

  return settled
    .filter((r): r is PromiseFulfilledResult<TracedSymbol> => r.status === 'fulfilled')
    .map((r) => r.value)
}
