// ---------------------------------------------------------------------------
// deep-analyzer.ts — Analyze changed files using full context + AI.
// Uses buildAnalyzerPrompt for rich context; parses JSON bugs from response.
// ---------------------------------------------------------------------------

import { chat } from '../services/ai-client.ts'
import { extractJsonArray } from './json-extractor.ts'
import { ANALYZER_SYSTEM_PROMPT, buildAnalyzerPrompt } from './analyzer-prompt.ts'
import type { ReviewFile } from './context-gatherer.ts'

/** Max parallel AI calls */
const MAX_CONCURRENCY = 5

/** Model used for deep analysis — strong reasoning required */
const ANALYSIS_MODEL = process.env.AI_ANALYSIS_MODEL ?? 'gpt-5.4'

/** Allow eval runner to override system prompt via env (prompt optimization loop) */
function getSystemPrompt(): string {
  return process.env.EVAL_PROMPT_OVERRIDE ?? ANALYZER_SYSTEM_PROMPT
}

// ---------------------------------------------------------------------------
// Bug type
// ---------------------------------------------------------------------------

export type RawBug = {
  file: string
  line: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: 'security' | 'logic' | 'performance' | 'style' | 'edge-case'
  title: string
  description: string
  suggestion: string
  evidence: string
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])
const VALID_CATEGORIES = new Set(['security', 'logic', 'performance', 'style', 'edge-case'])

function isValidBug(raw: unknown): raw is RawBug {
  if (!raw || typeof raw !== 'object') return false
  const b = raw as Record<string, unknown>
  return (
    typeof b.file === 'string' &&
    typeof b.line === 'number' &&
    typeof b.severity === 'string' && VALID_SEVERITIES.has(b.severity) &&
    typeof b.category === 'string' && VALID_CATEGORIES.has(b.category) &&
    typeof b.title === 'string' &&
    typeof b.description === 'string' &&
    typeof b.suggestion === 'string' &&
    typeof b.evidence === 'string'
  )
}

// ---------------------------------------------------------------------------
// Single-file analysis
// ---------------------------------------------------------------------------

/**
 * Analyze one changed file with full context.
 * Never throws — returns [] on any failure.
 */
export async function analyzeFile(reviewFile: ReviewFile): Promise<RawBug[]> {
  const promptText = buildAnalyzerPrompt(reviewFile)

  // Use AI_ANALYSIS_MODEL by temporarily overriding env for this call
  const prevModel = process.env.AI_MODEL
  process.env.AI_MODEL = ANALYSIS_MODEL

  let response: string
  try {
    response = await chat(
      [{ role: 'user', content: promptText }],
      { system: getSystemPrompt(), maxTokens: 4096 },
    )
  } catch (err) {
    console.warn(
      `[deep-analyzer] AI call failed for ${reviewFile.diffFile.path}:`,
      err instanceof Error ? err.message : String(err),
    )
    return []
  } finally {
    // Restore original model env
    if (prevModel === undefined) {
      delete process.env.AI_MODEL
    } else {
      process.env.AI_MODEL = prevModel
    }
  }

  const rawBugs = extractJsonArray<unknown>(response)
  const bugs = rawBugs.filter(isValidBug)

  if (bugs.length !== rawBugs.length) {
    console.warn(
      `[deep-analyzer] ${rawBugs.length - bugs.length} malformed bug(s) filtered for ${reviewFile.diffFile.path}`,
    )
  }

  return bugs
}

// ---------------------------------------------------------------------------
// Batch analysis (parallel, max MAX_CONCURRENCY)
// ---------------------------------------------------------------------------

/**
 * Analyze all changed files in parallel (max MAX_CONCURRENCY at a time).
 * Partial failure is tolerated — failed files are skipped with a warning.
 */
export async function analyzeAllFiles(files: ReviewFile[]): Promise<RawBug[]> {
  const allBugs: RawBug[] = []

  for (let i = 0; i < files.length; i += MAX_CONCURRENCY) {
    const batch = files.slice(i, i + MAX_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((f) => analyzeFile(f)))

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j]!
      const file = batch[j]!
      if (outcome.status === 'fulfilled') {
        allBugs.push(...outcome.value)
      } else {
        console.warn(
          `[deep-analyzer] skipping ${file.diffFile.path}:`,
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        )
      }
    }
  }

  console.log(`[deep-analyzer] Analyzed ${files.length} files, found ${allBugs.length} bugs`)
  return allBugs
}
