// ---------------------------------------------------------------------------
// eval-runner.ts — Run agent loop against golden dataset and compute metrics.
// Writes sample files to a temp dir so gatherReviewContexts can read them.
// ---------------------------------------------------------------------------

import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAgentLoop } from '../agent/agent-loop.ts'
import { matchBugs, type InjectedBug, type MatchResult } from './bug-matcher.ts'
import type { Bug } from '../utils/mock-fleet.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvalSample = {
  id: string
  description: string
  diff: string
  files: Record<string, string>
  injected_bugs: InjectedBug[]
}

export type EvalResult = {
  sampleId: string
  foundBugs: Bug[]
  groundTruth: InjectedBug[]
  match: MatchResult
  duration: number
}

export type EvalSummary = {
  totalSamples: number
  avgPrecision: number
  avgRecall: number
  avgF1: number
  totalDuration: number
  results: EvalResult[]
}

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

function writeSampleFiles(sample: EvalSample): string {
  const dir = join(tmpdir(), `ultrareview-eval-${sample.id}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })

  for (const [filePath, content] of Object.entries(sample.files)) {
    const fullPath = join(dir, filePath)
    mkdirSync(join(fullPath, '..'), { recursive: true })
    writeFileSync(fullPath, content, 'utf8')
  }

  return dir
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Non-critical cleanup
  }
}

// ---------------------------------------------------------------------------
// Single sample evaluation
// ---------------------------------------------------------------------------

async function evalSample(sample: EvalSample, dryRun: boolean): Promise<EvalResult> {
  const start = Date.now()

  if (dryRun) {
    return {
      sampleId: sample.id,
      foundBugs: [],
      groundTruth: sample.injected_bugs,
      match: matchBugs([], sample.injected_bugs),
      duration: 0,
    }
  }

  const tempDir = writeSampleFiles(sample)
  let foundBugs: Bug[] = []

  try {
    const result = await runAgentLoop(sample.diff, tempDir)
    foundBugs = result.bugs
  } finally {
    cleanupDir(tempDir)
  }

  const match = matchBugs(foundBugs, sample.injected_bugs)
  return {
    sampleId: sample.id,
    foundBugs,
    groundTruth: sample.injected_bugs,
    match,
    duration: Date.now() - start,
  }
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function summarize(results: EvalResult[]): EvalSummary {
  const n = results.length
  const avgPrecision = results.reduce((s, r) => s + r.match.precision, 0) / (n || 1)
  const avgRecall = results.reduce((s, r) => s + r.match.recall, 0) / (n || 1)
  const avgF1 = results.reduce((s, r) => s + r.match.f1, 0) / (n || 1)
  const totalDuration = results.reduce((s, r) => s + r.duration, 0)
  return { totalSamples: n, avgPrecision, avgRecall, avgF1, totalDuration, results }
}

// ---------------------------------------------------------------------------
// Print table
// ---------------------------------------------------------------------------

function printSummary(summary: EvalSummary): void {
  console.log('\n╔═══════════════════════════════════════════════════════╗')
  console.log('║              EVAL RESULTS SUMMARY                    ║')
  console.log('╠═══════════════════════════════════════════════════════╣')
  console.log(`║  Samples:    ${String(summary.totalSamples).padEnd(42)}║`)
  console.log(`║  Precision:  ${(summary.avgPrecision * 100).toFixed(1).padEnd(41)}%║`)
  console.log(`║  Recall:     ${(summary.avgRecall * 100).toFixed(1).padEnd(41)}%║`)
  console.log(`║  F1:         ${(summary.avgF1 * 100).toFixed(1).padEnd(41)}%║`)
  console.log(`║  Duration:   ${String(summary.totalDuration + 'ms').padEnd(42)}║`)
  console.log('╠═══════════════════════════════════════════════════════╣')

  for (const r of summary.results) {
    const tp = r.match.truePositives
    const fp = r.match.falsePositives
    const fn = r.match.falseNegatives
    const f1 = (r.match.f1 * 100).toFixed(0)
    console.log(`║  ${r.sampleId.padEnd(14)} TP=${tp} FP=${fp} FN=${fn} F1=${f1}%`.padEnd(56) + '║')
  }
  console.log('╚═══════════════════════════════════════════════════════╝\n')
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runEval(datasetPath: string, options?: { dryRun?: boolean }): Promise<EvalSummary> {
  const raw = readFileSync(datasetPath, 'utf8')
  const samples: EvalSample[] = JSON.parse(raw) as EvalSample[]

  console.log(`[eval] Loaded ${samples.length} samples from ${datasetPath}`)
  if (options?.dryRun) {
    console.log('[eval] Dry-run mode — skipping AI calls')
  }

  const results: EvalResult[] = []
  for (const sample of samples) {
    console.log(`[eval] Running sample ${sample.id}: ${sample.description}`)
    const result = await evalSample(sample, options?.dryRun ?? false)
    results.push(result)
    console.log(
      `[eval]   TP=${result.match.truePositives} FP=${result.match.falsePositives} FN=${result.match.falseNegatives} F1=${(result.match.f1 * 100).toFixed(0)}%`,
    )
  }

  const summary = summarize(results)
  printSummary(summary)
  return summary
}
