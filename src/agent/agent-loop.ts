// ---------------------------------------------------------------------------
// agent-loop.ts — Orchestrate the full 7-step analysis pipeline.
// Steps: gather → analyze → classify → verify → judge → filter → result
// ---------------------------------------------------------------------------

import { gatherReviewContexts } from './context-gatherer.ts'
import { analyzeAllFiles } from './deep-analyzer.ts'
import { classifyAllBugs } from './bug-classifier.ts'
import { verifyAllBugs } from './verifier.ts'
import { judgeBugs } from './judge.ts'
import { filterBugs } from './filter.ts'
import type { FleetResult } from '../utils/mock-fleet.ts'

type ProgressCallback = (step: string, detail: string) => void

// ---------------------------------------------------------------------------
// Helper: wrap a step with progress reporting and error safety
// ---------------------------------------------------------------------------

async function runStep<T>(
  name: string,
  detail: string,
  onProgress: ProgressCallback | undefined,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  onProgress?.(name, detail)
  try {
    return await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[agent-loop] Step "${name}" failed: ${msg}`)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runAgentLoop(
  diffText: string,
  repoRoot: string,
  onProgress?: ProgressCallback,
): Promise<FleetResult> {
  if (!diffText || diffText.trim().length === 0) {
    return { bugs: [], duration: 0 }
  }

  const start = Date.now()

  // Step 1: Gather review contexts from diff
  const files = await runStep(
    'gathering',
    'Parsing diff and reading file contexts',
    onProgress,
    () => gatherReviewContexts(diffText, repoRoot),
    [],
  )
  onProgress?.('gathering', `${files.length} files to review`)

  if (files.length === 0) {
    return { bugs: [], duration: Date.now() - start }
  }

  // Step 2: Deep-analyze each file for raw bugs
  const rawBugs = await runStep(
    'analyzing',
    `Analyzing ${files.length} files for bugs`,
    onProgress,
    () => analyzeAllFiles(files),
    [],
  )
  onProgress?.('analyzing', `${rawBugs.length} raw bugs found`)

  if (rawBugs.length === 0) {
    return { bugs: [], duration: Date.now() - start }
  }

  // Step 3: Classify bugs into 26-type taxonomy
  const classifiedBugs = await runStep(
    'classifying',
    `Classifying ${rawBugs.length} bugs into taxonomy`,
    onProgress,
    () => classifyAllBugs(rawBugs),
    rawBugs.map((b) => ({ ...b, domain: 'logic' as const, bugType: b.category, classificationConfidence: 0.3 })),
  )
  onProgress?.('classifying', `${classifiedBugs.length} bugs classified`)

  // Step 4: Verify each bug against actual source
  const verifiedBugs = await runStep(
    'verifying',
    `Verifying ${classifiedBugs.length} bugs against source`,
    onProgress,
    () => verifyAllBugs(classifiedBugs, repoRoot),
    classifiedBugs.map((b) => ({ ...b, verified: false, verificationEvidence: 'skipped', confidence: 0.5 })),
  )
  onProgress?.('verifying', `${verifiedBugs.filter((b) => b.verified).length} verified real`)

  // Step 5: Judge quality with separate model
  const judgedBugs = await runStep(
    'judging',
    `Scoring ${verifiedBugs.length} bugs with judge model`,
    onProgress,
    () => judgeBugs(verifiedBugs),
    verifiedBugs.map((b) => ({ ...b, judgeScore: b.confidence * 0.8, adjustedSeverity: b.severity, judgeReasoning: 'skipped' })),
  )
  onProgress?.('judging', `${judgedBugs.length} bugs scored`)

  // Step 6: Filter low-quality bugs and convert to final type
  const finalBugs = await runStep(
    'filtering',
    'Filtering low-confidence bugs',
    onProgress,
    async () => filterBugs(judgedBugs),
    [],
  )

  const duration = Date.now() - start
  onProgress?.('done', `${finalBugs.length} high-quality bugs in ${duration}ms`)

  return { bugs: finalBugs, duration }
}
