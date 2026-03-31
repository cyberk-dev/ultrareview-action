// ---------------------------------------------------------------------------
// bug-matcher.ts — Match found bugs against ground-truth injected bugs.
// Uses file + line (±5 tolerance) for matching; category is informational.
// ---------------------------------------------------------------------------

import type { Bug } from '../../src/utils/mock-fleet.ts'

export type InjectedBug = {
  file: string
  line: number
  severity: string
  category: string
  title: string
  description: string
}

export type MatchResult = {
  truePositives: number   // found bugs that match ground truth
  falsePositives: number  // found bugs with no ground truth match
  falseNegatives: number  // ground truth bugs not found
  precision: number       // TP / (TP + FP)
  recall: number          // TP / (TP + FN)
  f1: number              // 2 * P * R / (P + R)
  matches: Array<{ found: Bug; truth: InjectedBug }>
}

/** Tolerance window for line number matching */
const LINE_TOLERANCE = 5

// ---------------------------------------------------------------------------
// File match helpers
// ---------------------------------------------------------------------------

function filesMatch(foundFile: string, truthFile: string): boolean {
  if (foundFile === truthFile) return true
  // Normalize: strip leading ./ or /
  const normalize = (f: string) => f.replace(/^\.?\//, '')
  const a = normalize(foundFile)
  const b = normalize(truthFile)
  return a === b || a.endsWith(b) || b.endsWith(a)
}

function linesMatch(foundLine: number | undefined, truthLine: number): boolean {
  if (foundLine === undefined) return false
  return Math.abs(foundLine - truthLine) <= LINE_TOLERANCE
}

// ---------------------------------------------------------------------------
// Main matcher — greedy, closest-line-first
// ---------------------------------------------------------------------------

/**
 * Match found bugs against ground truth injected bugs.
 * Each truth bug can only be matched once (greedy by closest line).
 */
export function matchBugs(found: Bug[], groundTruth: InjectedBug[]): MatchResult {
  const unmatched = new Set<number>(groundTruth.map((_, i) => i))
  const matches: Array<{ found: Bug; truth: InjectedBug }> = []
  const falsePositiveBugs: Bug[] = []

  for (const foundBug of found) {
    // Collect candidate truth bugs (file + line within tolerance)
    const candidates = [...unmatched]
      .map((i) => ({ i, truth: groundTruth[i]! }))
      .filter(({ truth }) => filesMatch(foundBug.file, truth.file) && linesMatch(foundBug.line, truth.line))
      .sort((a, b) => {
        // Sort by closest line distance
        const distA = Math.abs((foundBug.line ?? 0) - a.truth.line)
        const distB = Math.abs((foundBug.line ?? 0) - b.truth.line)
        return distA - distB
      })

    if (candidates.length > 0) {
      const best = candidates[0]!
      matches.push({ found: foundBug, truth: best.truth })
      unmatched.delete(best.i)
    } else {
      falsePositiveBugs.push(foundBug)
    }
  }

  const tp = matches.length
  const fp = falsePositiveBugs.length
  const fn = unmatched.size

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1, matches }
}
