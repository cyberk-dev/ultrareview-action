// ---------------------------------------------------------------------------
// verifier.ts — Verify each bug by reading actual source code.
// v3: 100% deterministic verification — no AI call for evidence checking.
// Hard rejection: evidence not found in source → auto-reject (confidence=0).
// ---------------------------------------------------------------------------

import type { ClassifiedBug } from './bug-classifier.ts'
import {
  strictEvidenceMatch,
  extractReferencedSymbols,
  verifySymbols,
} from './verifier-helpers.ts'

const CONTEXT_LINES = 10
const MAX_CONCURRENCY = 10

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerifiedBug = ClassifiedBug & {
  verified: boolean
  verificationEvidence: string
  confidence: number // 0-1
  evidenceMatch: boolean
  symbolsVerified: boolean
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
// Read full file content for symbol verification
// ---------------------------------------------------------------------------

async function readFullFile(filePath: string): Promise<string | null> {
  try {
    const file = Bun.file(filePath)
    const exists = await file.exists()
    if (!exists) return null
    return await file.text()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Verify a single bug — deterministic, no AI call
// ---------------------------------------------------------------------------

export async function verifyBug(bug: ClassifiedBug, repoRoot: string): Promise<VerifiedBug> {
  const filePath = `${repoRoot}/${bug.file}`
  const sourceContext = await readSourceContext(filePath, bug.line)

  // Gate 1: File not found → reject
  if (!sourceContext) {
    return {
      ...bug,
      verified: false,
      verificationEvidence: 'source file not found',
      confidence: 0,
      evidenceMatch: false,
      symbolsVerified: false,
    }
  }

  // Gate 2: Strict evidence match — normalize whitespace, check ALL lines
  const evidenceFound = strictEvidenceMatch(bug.evidence, sourceContext)

  if (!evidenceFound) {
    return {
      ...bug,
      verified: false,
      verificationEvidence: 'evidence text not found in source code — possible hallucination',
      confidence: 0,
      evidenceMatch: false,
      symbolsVerified: false,
    }
  }

  // Gate 3: Symbol verification — check referenced identifiers exist in full file
  const fullContent = await readFullFile(filePath)
  const symbols = extractReferencedSymbols(bug.evidence, bug.description)
  const symbolResult = fullContent
    ? verifySymbols(symbols, fullContent)
    : { found: [], missing: symbols }

  if (symbolResult.missing.length > 0) {
    return {
      ...bug,
      verified: false,
      verificationEvidence: `referenced symbols not found: ${symbolResult.missing.join(', ')}`,
      confidence: 0.1,
      evidenceMatch: true,
      symbolsVerified: false,
    }
  }

  // All gates passed → verified
  return {
    ...bug,
    verified: true,
    verificationEvidence: 'evidence and all symbols verified in source',
    confidence: 0.9,
    evidenceMatch: true,
    symbolsVerified: true,
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
        const bug = batch[j]!
        results.push({
          ...bug,
          verified: false,
          verificationEvidence: 'verification failed',
          confidence: 0.1,
          evidenceMatch: false,
          symbolsVerified: false,
        })
      }
    }
  }

  const verified = results.filter((b) => b.verified).length
  const rejected = results.filter((b) => !b.evidenceMatch).length
  console.log(
    `[verifier] ${results.length} bugs: ${verified} verified, ${rejected} rejected (no evidence match), ${results.length - verified - rejected} uncertain`,
  )
  return results
}
