// ---------------------------------------------------------------------------
// eval-runner.ts — Run agent loop against golden dataset and compute metrics.
// Writes sample files to a temp dir so gatherReviewContexts can read them.
// v3: tracks hallucination rate as separate metric.
// ---------------------------------------------------------------------------

import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAgentLoop } from '../agent/agent-loop.ts'
import { matchBugs, type InjectedBug, type KnownFalsePositive, type MatchResult } from './bug-matcher.ts'
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
  known_false_positives?: KnownFalsePositive[]
  known_false_negatives?: Array<{ title: string }>
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
  hallucinationRate: number
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
      match: matchBugs([], sample.injected_bugs, sample.known_false_positives),
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

  const match = matchBugs(foundBugs, sample.injected_bugs, sample.known_false_positives)
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
  const hallucinationRate = results.reduce((s, r) => s + r.match.hallucinationRate, 0) / (n || 1)
  const totalDuration = results.reduce((s, r) => s + r.duration, 0)
  return { totalSamples: n, avgPrecision, avgRecall, avgF1, hallucinationRate, totalDuration, results }
}

// ---------------------------------------------------------------------------
// Print table
// ---------------------------------------------------------------------------

function printSummary(summary: EvalSummary): void {
  console.log('\n╔═══════════════════════════════════════════════════════╗')
  console.log('║              EVAL RESULTS SUMMARY                    ║')
  console.log('╠═══════════════════════════════════════════════════════╣')
  console.log(`║  Samples:        ${String(summary.totalSamples).padEnd(38)}║`)
  console.log(`║  Precision:      ${(summary.avgPrecision * 100).toFixed(1).padEnd(37)}%║`)
  console.log(`║  Recall:         ${(summary.avgRecall * 100).toFixed(1).padEnd(37)}%║`)
  console.log(`║  F1:             ${(summary.avgF1 * 100).toFixed(1).padEnd(37)}%║`)
  const hallStr = (summary.hallucinationRate * 100).toFixed(1)
  const hallLabel = summary.hallucinationRate > 0 ? `${hallStr}% ⚠` : `${hallStr}%`
  console.log(`║  Hallucination:  ${hallLabel.padEnd(38)}║`)
  console.log(`║  Duration:       ${String(summary.totalDuration + 'ms').padEnd(38)}║`)
  console.log('╠═══════════════════════════════════════════════════════╣')

  for (const r of summary.results) {
    const tp = r.match.truePositives
    const fp = r.match.falsePositives
    const fn = r.match.falseNegatives
    const hl = r.match.hallucinations
    const f1 = (r.match.f1 * 100).toFixed(0)
    console.log(`║  ${r.sampleId.padEnd(12)} TP=${tp} FP=${fp} FN=${fn} HL=${hl} F1=${f1}%`.padEnd(56) + '║')
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
      `[eval]   TP=${result.match.truePositives} FP=${result.match.falsePositives} FN=${result.match.falseNegatives} HL=${result.match.hallucinations} F1=${(result.match.f1 * 100).toFixed(0)}%`,
    )
  }

  const summary = summarize(results)
  printSummary(summary)
  return summary
}
