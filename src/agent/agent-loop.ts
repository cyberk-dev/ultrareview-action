// ---------------------------------------------------------------------------
// agent-loop.ts — Orchestrate the full 10-step analysis pipeline (v3).
// Steps: gather → [async-trace + schema-check + deletion-detect] → analyze
//        → classify → verify → judge → filter → result
// ---------------------------------------------------------------------------

import { gatherReviewContexts, type ReviewFile } from './context-gatherer.ts'
import { analyzeAllFiles } from './deep-analyzer.ts'
import { classifyAllBugs } from './bug-classifier.ts'
import { verifyAllBugs } from './verifier.ts'
import { judgeBugs } from './judge.ts'
import { filterBugs } from './filter.ts'
import { traceAsyncIssues, formatAsyncContext } from './async-tracer.ts'
import { analyzeSchema, formatSchemaContext } from './schema-analyzer.ts'
import { detectDeletionRisks, formatDeletionContext } from './deletion-detector.ts'
import { runGitNexusTracer } from './gitnexus-tracer.ts'
import { formatGitNexusSection } from './gitnexus-formatter.ts'
import type { FleetResult } from '../utils/mock-fleet.ts'

type ProgressCallback = (step: string, detail: string) => void

/** Max chars for additional context to avoid blowing prompt budget */
const MAX_ADDITIONAL_CONTEXT_CHARS = 5_000

// ---------------------------------------------------------------------------
// Derive base/head git refs for the GitNexus tracer.
// Falls back to MERGE_BASE..HEAD when no env override is provided.
// Never throws — returns empty strings which will cause tracer to skip.
// ---------------------------------------------------------------------------

async function resolveGitRefs(repoRoot: string): Promise<{ baseRef: string; headRef: string }> {
  // Allow explicit override for CI environments (e.g. GitHub Actions)
  const baseEnv = process.env['GITNEXUS_BASE_REF']
  const headEnv = process.env['GITNEXUS_HEAD_REF']
  if (baseEnv && headEnv) return { baseRef: baseEnv, headRef: headEnv }

  try {
    const { $ } = await import('bun')
    const head = (await $`git -C ${repoRoot} rev-parse HEAD`.quiet().text()).trim()
    // Try merge-base with origin/main or origin/master; fall back to HEAD~1
    let base = ''
    for (const upstream of ['origin/main', 'origin/master', 'HEAD~1']) {
      try {
        base = (await $`git -C ${repoRoot} merge-base HEAD ${upstream}`.quiet().text()).trim()
        if (base) break
      } catch {
        // try next
      }
    }
    if (!base) base = `${head}~1`
    return { baseRef: base, headRef: head }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[agent-loop] Could not resolve git refs for GitNexus: ${msg}`)
    return { baseRef: '', headRef: '' }
  }
}

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
// Build additional context from pre-analysis modules
// ---------------------------------------------------------------------------

function buildAdditionalContext(files: ReviewFile[], repoRoot: string) {
  return async () => {
    const [asyncResult, schemaResult, deletionResult] = await Promise.allSettled([
      Promise.resolve(traceAsyncIssues(files)),
      analyzeSchema(files, repoRoot),
      Promise.resolve(detectDeletionRisks(files)),
    ])

    const sections: string[] = []

    if (asyncResult.status === 'fulfilled' && asyncResult.value.length > 0) {
      sections.push(formatAsyncContext(asyncResult.value))
      console.log(`[agent-loop] Async tracer found ${asyncResult.value.length} issue(s)`)
    }
    if (schemaResult.status === 'fulfilled' && schemaResult.value.length > 0) {
      sections.push(formatSchemaContext(schemaResult.value))
      console.log(`[agent-loop] Schema analyzer found ${schemaResult.value.length} issue(s)`)
    }
    if (deletionResult.status === 'fulfilled' && deletionResult.value.length > 0) {
      sections.push(formatDeletionContext(deletionResult.value))
      console.log(`[agent-loop] Deletion detector found ${deletionResult.value.length} issue(s)`)
    }

    const combined = sections.join('\n\n')
    if (combined.length > MAX_ADDITIONAL_CONTEXT_CHARS) {
      return combined.slice(0, MAX_ADDITIONAL_CONTEXT_CHARS) + '\n... (truncated)'
    }
    return combined
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

  // Step 2: Resolve git refs for GitNexus tracer (best-effort, never throws)
  const { baseRef, headRef } = await resolveGitRefs(repoRoot)

  // Step 3: Pre-analysis enrichment (parallel: async + schema + deletion + GitNexus per-file)
  const [additionalContext, gitNexusSections] = await Promise.all([
    runStep(
      'pre-analysis',
      'Running async tracer, schema analyzer, deletion detector',
      onProgress,
      buildAdditionalContext(files, repoRoot),
      '',
    ),
    runStep(
      'gitnexus',
      `Tracing ${files.length} file(s) via GitNexus`,
      onProgress,
      async () => {
        const map = new Map<string, string>()
        if (!baseRef || !headRef) return map  // skip if refs unavailable

        await Promise.allSettled(
          files.map(async (f) => {
            const result = await runGitNexusTracer({
              filePath: f.diffFile.path,
              baseRef,
              headRef,
              repoPath: repoRoot,
            })
            const section = formatGitNexusSection(result)
            if (section) {
              map.set(f.diffFile.path, section)
              console.log(`[agent-loop] GitNexus IMPACT GRAPH for ${f.diffFile.path}: ${section.length} chars`)
            }
          }),
        )
        return map
      },
      new Map<string, string>(),
    ),
  ])
  if (additionalContext) {
    onProgress?.('pre-analysis', `Enriched context: ${additionalContext.length} chars`)
  }
  if (gitNexusSections.size > 0) {
    onProgress?.('gitnexus', `Impact graph built for ${gitNexusSections.size} file(s)`)
  }

  // Step 4: Deep-analyze each file for raw bugs (with enriched context + impact graph)
  const rawBugs = await runStep(
    'analyzing',
    `Analyzing ${files.length} files for bugs`,
    onProgress,
    () => analyzeAllFiles(files, additionalContext || undefined, gitNexusSections),
    [],
  )
  onProgress?.('analyzing', `${rawBugs.length} raw bugs found`)

  if (rawBugs.length === 0) {
    return { bugs: [], duration: Date.now() - start }
  }

  // Step 5: Classify bugs into 26-type taxonomy
  const classifiedBugs = await runStep(
    'classifying',
    `Classifying ${rawBugs.length} bugs into taxonomy`,
    onProgress,
    () => classifyAllBugs(rawBugs),
    rawBugs.map((b) => ({ ...b, domain: 'logic' as const, bugType: b.category, classificationConfidence: 0.3 })),
  )
  onProgress?.('classifying', `${classifiedBugs.length} bugs classified`)

  // Step 6: Verify each bug against actual source (deterministic, no AI)
  const verifiedBugs = await runStep(
    'verifying',
    `Verifying ${classifiedBugs.length} bugs against source`,
    onProgress,
    () => verifyAllBugs(classifiedBugs, repoRoot),
    classifiedBugs.map((b) => ({
      ...b, verified: false, verificationEvidence: 'skipped', confidence: 0.5,
      evidenceMatch: false, symbolsVerified: false,
    })),
  )
  onProgress?.('verifying', `${verifiedBugs.filter((b) => b.verified).length} verified real`)

  // Step 7: Judge quality with separate model
  const judgedBugs = await runStep(
    'judging',
    `Scoring ${verifiedBugs.length} bugs with judge model`,
    onProgress,
    () => judgeBugs(verifiedBugs),
    verifiedBugs.map((b) => ({ ...b, judgeScore: b.confidence * 0.8, adjustedSeverity: b.severity, judgeReasoning: 'skipped' })),
  )
  onProgress?.('judging', `${judgedBugs.length} bugs scored`)

  // Step 7: Filter low-quality bugs and convert to final type
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
