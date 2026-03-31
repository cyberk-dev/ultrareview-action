// ---------------------------------------------------------------------------
// judge.ts — Score bugs with a DIFFERENT model to avoid self-scoring bias.
// Analysis model: AI_ANALYSIS_MODEL (gpt-5.4)
// Judge model: AI_JUDGE_MODEL (gpt-5.2) — must differ from analysis model
// ---------------------------------------------------------------------------

import { chat } from '../services/ai-client.ts'
import { extractJsonArray } from './json-extractor.ts'
import type { VerifiedBug } from './verifier.ts'

/** Judge uses a separate model to avoid self-scoring bias */
const JUDGE_MODEL = process.env.AI_JUDGE_MODEL ?? 'gpt-5.2'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JudgedBug = VerifiedBug & {
  judgeScore: number // 0-1
  adjustedSeverity: VerifiedBug['severity']
  judgeReasoning: string
}

type JudgeResult = {
  bugIndex: number
  score: number
  adjustedSeverity: VerifiedBug['severity']
  reasoning: string
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM = `You are a QA lead reviewing automated bug reports.
For each bug, score 0-1 on:
- Is this a REAL bug or false positive? (weight: 0.4)
- Is the severity rating accurate? (weight: 0.3)
- Is the suggestion actionable and correct? (weight: 0.3)

Adjust severity if the scanner got it wrong.
Output JSON array only: [{ bugIndex, score, adjustedSeverity, reasoning }]
reasoning max 100 chars. No markdown, no prose.`

// ---------------------------------------------------------------------------
// Build compact bug summary for judge prompt
// ---------------------------------------------------------------------------

function buildJudgePayload(bugs: VerifiedBug[]): string {
  const payload = bugs.map((b, i) => ({
    bugIndex: i,
    title: b.title,
    severity: b.severity,
    file: `${b.file}:${b.line}`,
    description: b.description.slice(0, 200),
    suggestion: b.suggestion.slice(0, 150),
    verified: b.verified,
    confidence: b.confidence,
    evidence: b.verificationEvidence,
  }))
  return JSON.stringify(payload, null, 2)
}

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])

function isValidSeverity(s: unknown): s is VerifiedBug['severity'] {
  return typeof s === 'string' && VALID_SEVERITIES.has(s)
}

// ---------------------------------------------------------------------------
// Judge all bugs in one batch call
// ---------------------------------------------------------------------------

export async function judgeBugs(bugs: VerifiedBug[]): Promise<JudgedBug[]> {
  if (bugs.length === 0) return []

  const payload = buildJudgePayload(bugs)
  const prompt = `Review these ${bugs.length} automated bug reports:\n\n${payload}`

  const prevModel = process.env.AI_MODEL
  process.env.AI_MODEL = JUDGE_MODEL

  let results: JudgeResult[] = []

  try {
    const response = await chat(
      [{ role: 'user', content: prompt }],
      { system: JUDGE_SYSTEM, maxTokens: 3000 },
    )
    results = extractJsonArray<JudgeResult>(response)
  } catch (err) {
    console.warn('[judge] batch judging failed:', err instanceof Error ? err.message : String(err))
  } finally {
    if (prevModel === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = prevModel
  }

  // Map judge results back by index
  const resultMap = new Map<number, JudgeResult>()
  for (const r of results) {
    if (typeof r.bugIndex === 'number') resultMap.set(r.bugIndex, r)
  }

  return bugs.map((bug, i) => {
    const r = resultMap.get(i)
    if (r) {
      return {
        ...bug,
        judgeScore: typeof r.score === 'number' ? Math.min(1, Math.max(0, r.score)) : 0.5,
        adjustedSeverity: isValidSeverity(r.adjustedSeverity) ? r.adjustedSeverity : bug.severity,
        judgeReasoning: typeof r.reasoning === 'string' ? r.reasoning : '',
      }
    }
    // Judge result missing — use confidence-based default
    return {
      ...bug,
      judgeScore: bug.confidence * 0.8,
      adjustedSeverity: bug.severity,
      judgeReasoning: 'not scored by judge',
    }
  })
}
