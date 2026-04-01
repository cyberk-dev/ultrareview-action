// ---------------------------------------------------------------------------
// bug-matcher.ts — Match found bugs against ground-truth injected bugs.
// Uses file + line (±5 tolerance) for matching; tracks hallucination rate.
// ---------------------------------------------------------------------------

import type { Bug } from '../utils/mock-fleet.ts'

export type InjectedBug = {
  file: string
  line: number
  severity: string
  category: string
  title: string
  description: string
}

export type KnownFalsePositive = {
  title: string
  reason: string // contains 'hallucination' if fabricated
}

export type MatchResult = {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  hallucinations: number       // FPs where evidence was fabricated
  precision: number
  recall: number
  f1: number
  hallucinationRate: number    // hallucinations / total found
  matches: Array<{ found: Bug; truth: InjectedBug }>
}

const LINE_TOLERANCE = 5

// ---------------------------------------------------------------------------
// File match helpers
// ---------------------------------------------------------------------------

function filesMatch(foundFile: string, truthFile: string): boolean {
  if (foundFile === truthFile) return true
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

export function matchBugs(
  found: Bug[],
  groundTruth: InjectedBug[],
  knownFalsePositives?: KnownFalsePositive[],
): MatchResult {
  const unmatched = new Set<number>(groundTruth.map((_, i) => i))
  const matches: Array<{ found: Bug; truth: InjectedBug }> = []
  const falsePositiveBugs: Bug[] = []

  for (const foundBug of found) {
    const candidates = [...unmatched]
      .map((i) => ({ i, truth: groundTruth[i]! }))
      .filter(({ truth }) => filesMatch(foundBug.file, truth.file) && linesMatch(foundBug.line, truth.line))
      .sort((a, b) => {
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

  // Count hallucinations: FPs whose title fuzzy-matches a known_false_positive with 'hallucination' reason
  let hallucinations = 0
  if (knownFalsePositives && knownFalsePositives.length > 0) {
    for (const fp of falsePositiveBugs) {
      const isHallucination = knownFalsePositives.some(
        (kfp) =>
          kfp.reason.toLowerCase().includes('hallucination') &&
          fp.title.toLowerCase().includes(kfp.title.toLowerCase().slice(0, 20)),
      )
      if (isHallucination) hallucinations++
    }
  }

  const tp = matches.length
  const fp = falsePositiveBugs.length
  const fn = unmatched.size
  const totalFound = tp + fp

  const precision = totalFound > 0 ? tp / totalFound : 1
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const hallucinationRate = totalFound > 0 ? hallucinations / totalFound : 0

  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, hallucinations, precision, recall, f1, hallucinationRate, matches }
}
