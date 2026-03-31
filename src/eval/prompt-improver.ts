// ---------------------------------------------------------------------------
// prompt-improver.ts — Rewrite the system prompt using LLM based on failures.
// Uses the strongest model (gpt-5.4) for prompt engineering quality.
// ---------------------------------------------------------------------------

import { chat } from '../services/ai-client.ts'
import type { FailureAnalysis } from './failure-analyzer.ts'

/** Use strongest model for prompt engineering */
const IMPROVER_MODEL = process.env.AI_ANALYSIS_MODEL ?? 'gpt-5.4'

// ---------------------------------------------------------------------------
// Build a focused description of failure patterns
// ---------------------------------------------------------------------------

function describePatterns(analysis: FailureAnalysis): string {
  const lines: string[] = []

  if (analysis.falsePositives.length > 0) {
    lines.push('FALSE POSITIVE patterns (bugs flagged that are NOT real):')
    for (const p of analysis.falsePositives) {
      lines.push(`  - ${p.pattern} (count: ${p.count})`)
    }
  }

  if (analysis.falseNegatives.length > 0) {
    lines.push('FALSE NEGATIVE patterns (real bugs that were MISSED):')
    for (const p of analysis.falseNegatives) {
      lines.push(`  - ${p.pattern} (count: ${p.count})`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function improvePrompt(
  currentPrompt: string,
  analysis: FailureAnalysis,
  iteration: number,
): Promise<string> {
  const patternDescription = describePatterns(analysis)

  const userMessage = [
    'You are an expert prompt engineer. Here is a system prompt for a code review AI:',
    '',
    '```',
    currentPrompt,
    '```',
    '',
    `The reviewer has these failure patterns (iteration ${iteration}):`,
    '',
    analysis.summary,
    '',
    patternDescription,
    '',
    'Rewrite the system prompt to fix these failures. Rules:',
    '- Keep the JSON output format exactly the same',
    '- Do not make it longer than 2x the original',
    '- Focus on the specific failure patterns, do not make generic changes',
    '- The prompt must still output a JSON array of bugs',
    '- Do not add new sections unless directly addressing a failure pattern',
    '',
    'Respond with ONLY the improved system prompt, no explanation.',
  ].join('\n')

  const prevModel = process.env.AI_MODEL
  process.env.AI_MODEL = IMPROVER_MODEL

  try {
    const improved = await chat(
      [{ role: 'user', content: userMessage }],
      { maxTokens: 4096 },
    )
    const trimmed = improved.trim()
    // Guard: if LLM returned something clearly wrong, keep current
    if (trimmed.length < 100) {
      console.warn('[prompt-improver] LLM returned suspiciously short prompt, keeping current')
      return currentPrompt
    }
    return trimmed
  } catch (err) {
    console.warn('[prompt-improver] LLM call failed:', err instanceof Error ? err.message : String(err))
    return currentPrompt
  } finally {
    if (prevModel === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = prevModel
  }
}
