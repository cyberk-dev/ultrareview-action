// ---------------------------------------------------------------------------
// auto-optimizer.ts — Optimization loop: eval → analyze → improve → repeat.
// Tracks best prompt, saves artifacts to results/, prints iteration table.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEval } from './eval-runner.ts'
import { analyzeFailures, type FailureAnalysis } from './failure-analyzer.ts'
import { improvePrompt } from './prompt-improver.ts'
import { ANALYZER_SYSTEM_PROMPT } from '../agent/analyzer-prompt.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptimizationConfig = {
  datasetPath: string
  maxIterations: number
  targetPrecision: number
  targetRecall: number
  staleIterations: number
}

export type IterationResult = {
  iteration: number
  prompt: string
  metrics: { precision: number; recall: number; f1: number }
  analysis?: FailureAnalysis
  improved: boolean
}

export type OptimizationResult = {
  iterations: IterationResult[]
  bestIteration: number
  bestPrompt: string
  bestMetrics: { precision: number; recall: number; f1: number }
}

const RESULTS_DIR = join(import.meta.dir, '../../../results')

const DEFAULT_CONFIG: OptimizationConfig = {
  datasetPath: join(import.meta.dir, '../../../benchmark/golden-review-dataset.json'),
  maxIterations: 10,
  targetPrecision: 0.8,
  targetRecall: 0.7,
  staleIterations: 3,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureResultsDir(): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
}

function metricsScore(m: { precision: number; recall: number; f1: number }): number {
  return m.f1
}

function targetsReached(
  metrics: { precision: number; recall: number },
  config: OptimizationConfig,
): boolean {
  return metrics.precision >= config.targetPrecision && metrics.recall >= config.targetRecall
}

function printIterationTable(iterations: IterationResult[]): void {
  console.log('\n╔════════════════════════════════════════════════════════╗')
  console.log('║           OPTIMIZATION ITERATION SUMMARY               ║')
  console.log('╠════╦═══════════╦══════════╦══════════╦═════════════════╣')
  console.log('║ It ║ Precision ║  Recall  ║    F1    ║    Improved?    ║')
  console.log('╠════╬═══════════╬══════════╬══════════╬═════════════════╣')
  for (const it of iterations) {
    const p = (it.metrics.precision * 100).toFixed(1).padStart(7)
    const r = (it.metrics.recall * 100).toFixed(1).padStart(7)
    const f = (it.metrics.f1 * 100).toFixed(1).padStart(7)
    const improved = it.improved ? '   YES   ' : '    -    '
    console.log(`║ ${String(it.iteration).padStart(2)} ║  ${p}%  ║  ${r}%  ║  ${f}%  ║  ${improved}       ║`)
  }
  console.log('╚════╩═══════════╩══════════╩══════════╩═════════════════╝\n')
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runOptimization(config?: Partial<OptimizationConfig>): Promise<OptimizationResult> {
  const cfg: OptimizationConfig = { ...DEFAULT_CONFIG, ...config }
  ensureResultsDir()

  console.log('[optimizer] Starting auto-prompt optimization')
  console.log(`[optimizer] Dataset: ${cfg.datasetPath}`)
  console.log(`[optimizer] Max iterations: ${cfg.maxIterations}, stale limit: ${cfg.staleIterations}`)
  console.log(`[optimizer] Targets: precision=${cfg.targetPrecision}, recall=${cfg.targetRecall}`)

  let currentPrompt = ANALYZER_SYSTEM_PROMPT
  const iterations: IterationResult[] = []
  let bestIteration = 0
  let bestPrompt = currentPrompt
  let bestMetrics = { precision: 0, recall: 0, f1: 0 }
  let staleCount = 0

  for (let i = 1; i <= cfg.maxIterations; i++) {
    console.log(`\n[optimizer] === Iteration ${i}/${cfg.maxIterations} ===`)

    // Set prompt override for eval
    process.env.EVAL_PROMPT_OVERRIDE = currentPrompt

    let summary
    try {
      summary = await runEval(cfg.datasetPath)
    } catch (err) {
      console.warn(`[optimizer] Iteration ${i} eval failed:`, err instanceof Error ? err.message : String(err))
      iterations.push({ iteration: i, prompt: currentPrompt, metrics: { precision: 0, recall: 0, f1: 0 }, improved: false })
      continue
    }

    const metrics = {
      precision: summary.avgPrecision,
      recall: summary.avgRecall,
      f1: summary.avgF1,
    }

    const improved = metricsScore(metrics) > metricsScore(bestMetrics)
    if (improved) {
      bestMetrics = metrics
      bestPrompt = currentPrompt
      bestIteration = i
      staleCount = 0
    } else {
      staleCount++
    }

    // Check targets reached
    if (targetsReached(metrics, cfg)) {
      console.log(`[optimizer] Targets reached at iteration ${i}!`)
      iterations.push({ iteration: i, prompt: currentPrompt, metrics, improved })
      break
    }

    // Analyze failures and improve prompt (skip on last iteration)
    let analysis: FailureAnalysis | undefined
    let nextPrompt = currentPrompt

    if (i < cfg.maxIterations && staleCount < cfg.staleIterations) {
      try {
        analysis = await analyzeFailures(summary.results, currentPrompt)
        console.log(`[optimizer] Analysis: ${analysis.summary}`)
        nextPrompt = await improvePrompt(currentPrompt, analysis, i)
        console.log(`[optimizer] Prompt updated (${nextPrompt.length} chars)`)
      } catch (err) {
        console.warn('[optimizer] Analysis/improve failed:', err instanceof Error ? err.message : String(err))
      }
    }

    iterations.push({ iteration: i, prompt: currentPrompt, metrics, analysis, improved })
    currentPrompt = nextPrompt

    // Stop early if stale
    if (staleCount >= cfg.staleIterations) {
      console.log(`[optimizer] No improvement for ${cfg.staleIterations} iterations, stopping early`)
      break
    }
  }

  // Restore best prompt to env
  process.env.EVAL_PROMPT_OVERRIDE = bestPrompt

  // Save artifacts
  writeFileSync(join(RESULTS_DIR, 'best-prompt.txt'), bestPrompt, 'utf8')
  writeFileSync(
    join(RESULTS_DIR, 'optimization-log.json'),
    JSON.stringify({ config: cfg, iterations: iterations.map((it) => ({ ...it, prompt: it.prompt.slice(0, 200) + '...' })), bestIteration, bestMetrics }, null, 2),
    'utf8',
  )

  console.log(`[optimizer] Best prompt saved to results/best-prompt.txt`)
  console.log(`[optimizer] Full log saved to results/optimization-log.json`)

  printIterationTable(iterations)

  return { iterations, bestIteration, bestPrompt, bestMetrics }
}
