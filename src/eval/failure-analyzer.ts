// ---------------------------------------------------------------------------
// failure-analyzer.ts — Collect and analyze eval failure patterns via LLM.
// Identifies false positives / false negatives and explains root causes.
// ---------------------------------------------------------------------------

import { chat } from '../services/ai-client.ts'
import type { EvalResult } from './eval-runner.ts'
import type { Bug } from '../utils/mock-fleet.ts'
import type { InjectedBug } from './bug-matcher.ts'

/** Model for failure pattern analysis */
const JUDGE_MODEL = process.env.AI_JUDGE_MODEL ?? 'gpt-5.2'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailurePattern = {
  category: 'false_positive' | 'false_negative'
  count: number
  examples: Array<{
    sampleId: string
    bug: Bug | InjectedBug
    context: string
  }>
  pattern: string
}

export type FailureAnalysis = {
  falsePositives: FailurePattern[]
  falseNegatives: FailurePattern[]
  summary: string
}

// ---------------------------------------------------------------------------
// Collect raw failures from eval results
// ---------------------------------------------------------------------------

export function collectFailures(results: EvalResult[]): {
  falsePositives: Array<{ sampleId: string; bug: Bug }>
  falseNegatives: Array<{ sampleId: string; bug: InjectedBug }>
} {
  const falsePositives: Array<{ sampleId: string; bug: Bug }> = []
  const falseNegatives: Array<{ sampleId: string; bug: InjectedBug }> = []

  for (const result of results) {
    // Build set of matched found bug titles
    const matchedFoundTitles = new Set(result.match.matches.map((m) => m.found.title))

    // False positives: found bugs that were NOT matched to any ground truth
    for (const bug of result.foundBugs) {
      if (!matchedFoundTitles.has(bug.title)) {
        falsePositives.push({ sampleId: result.sampleId, bug })
      }
    }

    // False negatives: ground truth bugs that were NOT matched
    const matchedTruthTitles = new Set(result.match.matches.map((m) => m.truth.title))
    for (const truth of result.groundTruth) {
      if (!matchedTruthTitles.has(truth.title)) {
        falseNegatives.push({ sampleId: result.sampleId, bug: truth })
      }
    }
  }

  return { falsePositives, falseNegatives }
}

// ---------------------------------------------------------------------------
// Format failures for LLM prompt
// ---------------------------------------------------------------------------

function formatFP(fp: Array<{ sampleId: string; bug: Bug }>): string {
  if (fp.length === 0) return '(none)'
  return fp
    .slice(0, 10)
    .map(
      ({ sampleId, bug }) =>
        `- [${sampleId}] ${bug.file}:${bug.line ?? '?'} — "${bug.title}" (${bug.severity})\n  ${bug.description}`,
    )
    .join('\n')
}

function formatFN(fn: Array<{ sampleId: string; bug: InjectedBug }>): string {
  if (fn.length === 0) return '(none)'
  return fn
    .slice(0, 10)
    .map(
      ({ sampleId, bug }) =>
        `- [${sampleId}] ${bug.file}:${bug.line} — "${bug.title}" (${bug.severity}/${bug.category})\n  ${bug.description}`,
    )
    .join('\n')
}

// ---------------------------------------------------------------------------
// Main export — LLM-based failure analysis
// ---------------------------------------------------------------------------

export async function analyzeFailures(
  results: EvalResult[],
  currentPrompt: string,
): Promise<FailureAnalysis> {
  const { falsePositives, falseNegatives } = collectFailures(results)

  const userMessage = [
    'Here is the current system prompt for a code reviewer:',
    '```',
    currentPrompt,
    '```',
    '',
    `Here are the false positives (${falsePositives.length} bugs flagged that are NOT real):`,
    formatFP(falsePositives),
    '',
    `Here are the false negatives (${falseNegatives.length} real bugs that were MISSED):`,
    formatFN(falseNegatives),
    '',
    'Analyze the patterns. Why is the reviewer making these mistakes?',
    'Group into at most 3 patterns per category.',
    'Respond with a JSON object matching this shape exactly:',
    '{"falsePositives":[{"pattern":"...","examples":[],"count":0}],"falseNegatives":[{"pattern":"...","examples":[],"count":0}],"summary":"..."}',
  ].join('\n')

  const prevModel = process.env.AI_MODEL
  process.env.AI_MODEL = JUDGE_MODEL

  let raw: string
  try {
    raw = await chat([{ role: 'user', content: userMessage }], { maxTokens: 2048 })
  } catch (err) {
    console.warn('[failure-analyzer] LLM call failed:', err instanceof Error ? err.message : String(err))
    return buildEmptyAnalysis(falsePositives, falseNegatives)
  } finally {
    if (prevModel === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = prevModel
  }

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim()
    const parsed = JSON.parse(cleaned) as {
      falsePositives: Array<{ pattern: string; count: number }>
      falseNegatives: Array<{ pattern: string; count: number }>
      summary: string
    }
    return {
      falsePositives: (parsed.falsePositives ?? []).map((p) => ({
        category: 'false_positive' as const,
        count: p.count ?? 0,
        examples: [],
        pattern: p.pattern ?? '',
      })),
      falseNegatives: (parsed.falseNegatives ?? []).map((p) => ({
        category: 'false_negative' as const,
        count: p.count ?? 0,
        examples: [],
        pattern: p.pattern ?? '',
      })),
      summary: parsed.summary ?? '',
    }
  } catch {
    console.warn('[failure-analyzer] Failed to parse LLM response, using fallback')
    return buildEmptyAnalysis(falsePositives, falseNegatives)
  }
}

function buildEmptyAnalysis(
  fps: Array<{ sampleId: string; bug: Bug }>,
  fns: Array<{ sampleId: string; bug: InjectedBug }>,
): FailureAnalysis {
  return {
    falsePositives: fps.length > 0 ? [{ category: 'false_positive', count: fps.length, examples: [], pattern: 'Unknown FP pattern' }] : [],
    falseNegatives: fns.length > 0 ? [{ category: 'false_negative', count: fns.length, examples: [], pattern: 'Unknown FN pattern' }] : [],
    summary: `${fps.length} false positives, ${fns.length} false negatives. Analysis unavailable.`,
  }
}
