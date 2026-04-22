// ---------------------------------------------------------------------------
// gitnexus-process-resolver.ts — resolves process/flow chains per symbol
// Called by gitnexus-tracer.ts; separated to keep tracer under 200 LOC.
// ---------------------------------------------------------------------------

import { query } from './gitnexus-typed-wrappers'
import type { ProcessChain, ProcessStep } from './gitnexus-tracer'

/** Max processes returned per symbol — budget guard. */
const MAX_PROCESSES_PER_SYMBOL = 2

/**
 * Look up process chains that include a given symbol.
 * Marks steps where the symbol is the changed one (isChangedSymbol=true).
 * Returns up to MAX_PROCESSES_PER_SYMBOL chains; returns [] on any error.
 */
export async function resolveParticipatedProcesses(
  repo: string,
  symbolName: string,
  symbolId: string | undefined,
  moduleHint: string | undefined,
): Promise<ProcessChain[]> {
  try {
    const result = await query(repo, symbolName, moduleHint, 3)
    if (result.processes.length === 0) return []

    const chains: ProcessChain[] = []

    for (const proc of result.processes) {
      // Filter process_symbols to this process, sorted by step_index
      const steps = result.process_symbols
        .filter(ps => ps.process_id === proc.id)
        .sort((a, b) => a.step_index - b.step_index)

      if (steps.length === 0) continue

      // Determine if our symbol is a step in this process
      const symbolParticipates = steps.some(
        s => s.name === symbolName || (symbolId && s.id === symbolId),
      )
      if (!symbolParticipates) continue

      const mappedSteps: ProcessStep[] = steps.map(s => ({
        name: s.name,
        file: s.file,
        startLine: s.start_line,
        endLine: s.end_line,
        stepIndex: s.step_index,
        isChangedSymbol: s.name === symbolName || (symbolId !== undefined && s.id === symbolId),
      }))

      const label = `${proc.entry_function} → ${proc.terminal_function}`
      const processType =
        proc.process_type === 'cross_community' ? 'cross_community' : 'intra_community'

      chains.push({
        id: proc.id,
        label,
        processType,
        stepCount: proc.step_count,
        steps: mappedSteps,
      })

      if (chains.length >= MAX_PROCESSES_PER_SYMBOL) break
    }

    return chains
  } catch {
    return []
  }
}
