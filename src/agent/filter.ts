// ---------------------------------------------------------------------------
// filter.ts — Drop low-quality bugs, convert to final Bug type.
// Thresholds: confidence >= 0.7 AND judgeScore >= 0.6
// ---------------------------------------------------------------------------

import type { JudgedBug } from './judge.ts'
import type { Bug } from '../utils/mock-fleet.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FilterConfig = {
  minConfidence: number // default 0.7
  minJudgeScore: number // default 0.6
}

const DEFAULT_CONFIG: FilterConfig = {
  minConfidence: parseFloat(process.env.FILTER_MIN_CONFIDENCE || '0.7'),
  minJudgeScore: parseFloat(process.env.FILTER_MIN_JUDGE_SCORE || '0.6'),
}

const SEVERITY_ORDER: Record<Bug['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

// ---------------------------------------------------------------------------
// Convert JudgedBug → final Bug type
// ---------------------------------------------------------------------------

function toFinalBug(b: JudgedBug): Bug {
  return {
    severity: b.adjustedSeverity,
    file: b.file,
    line: b.line,
    title: b.title,
    description: b.description,
    suggestion: b.suggestion,
    verified: true, // Passed both confidence + judge thresholds
  }
}

// ---------------------------------------------------------------------------
// Filter and convert
// ---------------------------------------------------------------------------

export function filterBugs(bugs: JudgedBug[], config?: Partial<FilterConfig>): Bug[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const total = bugs.length

  const passing = bugs.filter(
    (b) => b.confidence >= cfg.minConfidence && b.judgeScore >= cfg.minJudgeScore,
  )

  const dropped = total - passing.length
  console.log(`[filter] Filtered ${total} → ${passing.length} bugs (dropped ${dropped} low-confidence)`)

  const converted = passing.map(toFinalBug)
  converted.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return converted
}
