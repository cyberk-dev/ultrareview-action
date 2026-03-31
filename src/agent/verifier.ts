// ---------------------------------------------------------------------------
// verifier.ts — Verify each bug by reading actual source code.
// Reads file at bug location, checks evidence match, uses AI to confirm.
// ---------------------------------------------------------------------------

import { chat } from '../services/ai-client.ts'
import type { ClassifiedBug } from './bug-classifier.ts'

const VERIFY_MODEL = process.env.AI_CLASSIFY_MODEL ?? 'gpt-5.4-mini'
const CONTEXT_LINES = 10
const MAX_CONCURRENCY = 10

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerifiedBug = ClassifiedBug & {
  verified: boolean
  verificationEvidence: string
  confidence: number // 0-1
}

// ---------------------------------------------------------------------------
// Read lines around a bug location
// ---------------------------------------------------------------------------

async function readSourceContext(filePath: string, line: number): Promise<string | null> {
  try {
    const file = Bun.file(filePath)
    const exists = await file.exists()
    if (!exists) return null

    const text = await file.text()
    const lines = text.split('\n')
    const start = Math.max(0, line - 1 - CONTEXT_LINES)
    const end = Math.min(lines.length, line - 1 + CONTEXT_LINES)

    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join('\n')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Fuzzy match: check if evidence string appears in source context
// ---------------------------------------------------------------------------

function evidenceMatchesSource(evidence: string, sourceContext: string): boolean {
  const normEvidence = evidence.trim().toLowerCase()
  const normSource = sourceContext.toLowerCase()
  if (!normEvidence) return false
  // Use first 60 chars of evidence for matching
  return normSource.includes(normEvidence.slice(0, 60))
}

const VERIFY_SYSTEM = `You are a code reviewer verifying bug reports.
Given bug details and actual source code, determine if the bug is real.
Output JSON: { verified: boolean, confidence: number, evidence: string }
confidence is 0-1. evidence is a brief explanation (max 100 chars).`

// ---------------------------------------------------------------------------
// Verify a single bug
// ---------------------------------------------------------------------------

export async function verifyBug(bug: ClassifiedBug, repoRoot: string): Promise<VerifiedBug> {
  const filePath = `${repoRoot}/${bug.file}`
  const sourceContext = await readSourceContext(filePath, bug.line)

  if (!sourceContext) {
    // File not readable — low confidence unverified
    return { ...bug, verified: false, verificationEvidence: 'source file not found', confidence: 0.2 }
  }

  // Quick evidence match check — boosts or reduces confidence
  const evidenceMatch = evidenceMatchesSource(bug.evidence, sourceContext)

  const prompt = `Bug: ${bug.title}
Description: ${bug.description}
Evidence claimed: ${bug.evidence}
File: ${bug.file} line ${bug.line}

Actual source code (±${CONTEXT_LINES} lines):
\`\`\`
${sourceContext}
\`\`\`

Evidence match in source: ${evidenceMatch ? 'YES' : 'NO'}

Is this bug real? Output JSON only.`

  const prevModel = process.env.AI_MODEL
  process.env.AI_MODEL = VERIFY_MODEL

  try {
    const response = await chat(
      [{ role: 'user', content: prompt }],
      { system: VERIFY_SYSTEM, maxTokens: 512 },
    )

    // Parse AI response
    const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned) as { verified?: boolean; confidence?: number; evidence?: string }

    const baseConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    // Boost confidence if evidence matched source
    const confidence = evidenceMatch ? Math.min(1, baseConfidence + 0.1) : baseConfidence

    return {
      ...bug,
      verified: parsed.verified ?? confidence >= 0.6,
      verificationEvidence: parsed.evidence ?? (evidenceMatch ? 'evidence matches source' : 'no evidence match'),
      confidence,
    }
  } catch {
    // AI failed — use evidence match as signal
    const confidence = evidenceMatch ? 0.6 : 0.4
    return {
      ...bug,
      verified: evidenceMatch,
      verificationEvidence: evidenceMatch ? 'evidence matches source (AI unavailable)' : 'could not verify',
      confidence,
    }
  } finally {
    if (prevModel === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = prevModel
  }
}

// ---------------------------------------------------------------------------
// Verify all bugs (parallel, max MAX_CONCURRENCY)
// ---------------------------------------------------------------------------

export async function verifyAllBugs(bugs: ClassifiedBug[], repoRoot: string): Promise<VerifiedBug[]> {
  const results: VerifiedBug[] = []

  for (let i = 0; i < bugs.length; i += MAX_CONCURRENCY) {
    const batch = bugs.slice(i, i + MAX_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((b) => verifyBug(b, repoRoot)))

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j]!
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value)
      } else {
        // Return unverified with low confidence on failure
        const bug = batch[j]!
        results.push({ ...bug, verified: false, verificationEvidence: 'verification failed', confidence: 0.1 })
      }
    }
  }

  const verified = results.filter((b) => b.verified).length
  console.log(`[verifier] ${results.length} bugs verified: ${verified} real, ${results.length - verified} uncertain`)
  return results
}
