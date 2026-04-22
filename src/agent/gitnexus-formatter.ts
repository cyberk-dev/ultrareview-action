// gitnexus-formatter.ts — Format GitNexusTracerResult into a plain-text IMPACT GRAPH section.
// Pure function: no I/O, no side effects. Returns '' on skipped/empty result.
// Budget: 3000 chars. Truncation is tiered (see truncateSymbols).
// Security: symbol names / file paths are sanitised to prevent prompt injection.

import type { GitNexusTracerResult, TracedSymbol, ProcessChain, ProcessStep } from './gitnexus-tracer.ts'

const SECTION_BUDGET = 3_000

// -- Sanitise user-controlled strings (backticks, fences, control chars) --

function sanitise(raw: string): string {
  return raw
    .replace(/`+/g, "'")             // backticks → single quotes
    .replace(/\/{3,}/g, '//')        // triple+ slashes (edge case)
    .replace(/[\x00-\x1F\x7F]/g, '') // strip control chars
    .trim()
}

// -- Critical-process heuristic --

const CRITICAL_RE = /login|auth|checkout|payment|signup/i

/** Returns true if the process label matches a critical-path keyword. */
export function isCriticalProcess(label: string): boolean {
  return CRITICAL_RE.test(label)
}

// -- Process chain formatting --

function formatStepLine(step: ProcessStep, changedName: string, idx: number): string {
  const marker = step.isChangedSymbol || sanitise(step.name) === changedName ? '    <- CHANGED' : ''
  return `        ${idx}. ${sanitise(step.name)} (${sanitise(step.file)}:${step.startLine})${marker}`
}

/** Format one process chain. Elides middle steps when stepCount > 8. */
function formatProcess(chain: ProcessChain, changedName: string): string {
  const label = sanitise(chain.label)
  const critMarker = isCriticalProcess(label) ? ' [critical path]' : ''
  const header = `      Process: "${label}" (${chain.stepCount} steps, ${chain.processType})${critMarker}`

  let stepLines: string[]
  if (chain.stepCount > 8) {
    const first3 = chain.steps.slice(0, 3).map((s, i) => formatStepLine(s, changedName, i + 1))
    const last2  = chain.steps.slice(-2).map((s, i) => formatStepLine(s, changedName, chain.stepCount - 1 + i))
    stepLines = [...first3, `        ... ${chain.stepCount - 5} steps elided ...`, ...last2]
  } else {
    stepLines = chain.steps.map((s, i) => formatStepLine(s, changedName, i + 1))
  }

  return [header, ...stepLines].join('\n')
}

// -- Symbol formatting --

interface RenderOpts { includeCallees: boolean; maxProcesses: number }

function formatSymbol(sym: TracedSymbol, opts: RenderOpts): string {
  const name = sanitise(sym.name)
  const lines: string[] = []
  lines.push(`  ${name} (${sanitise(sym.kind)}) [lines ${sym.startLine}-${sym.endLine}]`)

  if (sym.callers.length > 0) {
    const list = sym.callers.slice(0, 6).map((c) => `${sanitise(c.name)} (${sanitise(c.file)}:${c.line})`).join(', ')
    lines.push(`    Callers (${sym.callers.length}): ${list}`)
  }
  if (opts.includeCallees && sym.callees.length > 0) {
    const list = sym.callees.slice(0, 6).map((c) => `${sanitise(c.name)} (${sanitise(c.file)}:${c.line})`).join(', ')
    lines.push(`    Callees (${sym.callees.length}): ${list}`)
  }
  lines.push(`    Impact: ${sym.impact.files} files, ${sym.impact.symbols} symbols`)

  for (const chain of sym.participatedProcesses.slice(0, opts.maxProcesses)) {
    lines.push('', formatProcess(chain, name))
  }
  return lines.join('\n')
}

// -- Tiered truncation --

/** Try to render all symbols within budget at given opts. Returns count that fit. */
function renderWithOpts(symbols: TracedSymbol[], opts: RenderOpts, budget: number): { text: string; included: number } {
  const parts: string[] = []
  let chars = 0
  for (let i = 0; i < symbols.length; i++) {
    const block = formatSymbol(symbols[i]!, opts)
    const withSep = (i > 0 ? '\n\n' : '') + block
    if (chars + withSep.length > budget) return { text: parts.join('\n\n'), included: i }
    parts.push(block)
    chars += withSep.length
  }
  return { text: parts.join('\n\n'), included: symbols.length }
}

/**
 * Tiered truncation per phase-03 spec. Drop order:
 * 1. Phase-4 signals (not present yet)
 * 2. Process step elision (handled inside formatProcess)
 * 3. Drop 2nd process per symbol
 * 4. Drop callees
 * 5. Cap symbols, append [+N more omitted]
 */
function truncateSymbols(symbols: TracedSymbol[], budget: number): { body: string; omitted: number } {
  const total = symbols.length
  const tiers: RenderOpts[] = [
    { includeCallees: true,  maxProcesses: 2 },
    { includeCallees: true,  maxProcesses: 1 },
    { includeCallees: false, maxProcesses: 1 },
    { includeCallees: false, maxProcesses: 0 },
  ]
  for (const opts of tiers) {
    const { text, included } = renderWithOpts(symbols, opts, budget)
    if (included === total) return { body: text, omitted: 0 }
    if (included > 0) return { body: text, omitted: total - included }
  }
  // Nothing fits — render first symbol only, hard-slice to budget
  const first = symbols[0]
  if (!first) return { body: '', omitted: total }
  return { body: formatSymbol(first, { includeCallees: false, maxProcesses: 0 }).slice(0, budget), omitted: total - 1 }
}

// -- Public API --

/**
 * Format a GitNexusTracerResult into the IMPACT GRAPH prompt section.
 * Returns '' when status is skipped or symbols list is empty (no noise added).
 * Total output capped at SECTION_BUDGET chars with tiered truncation.
 */
export function formatGitNexusSection(result: GitNexusTracerResult): string {
  if (result.status === 'skipped' || result.symbols.length === 0) return ''

  const HEADER = `=== IMPACT GRAPH (GitNexus) ===\nFile: ${sanitise(result.filePath)}\nChanged symbols: ${result.symbols.length}\n\n`
  const FOOTER = `\nNotes: Dynamic dispatch resolved via AST (vs grep). Processes show end-to-end flow.\n===`
  const PARTIAL  = result.status === 'partial' ? '\n[partial — budget exceeded]' : ''
  const bodyBudget = Math.max(0, SECTION_BUDGET - HEADER.length - FOOTER.length - PARTIAL.length - 50)

  const { body, omitted } = truncateSymbols(result.symbols, bodyBudget)
  const omittedSuffix = omitted > 0 ? `\n[+${omitted} more symbols omitted]` : ''

  return `${HEADER}${body}${omittedSuffix}${PARTIAL}\n${FOOTER}`
}
