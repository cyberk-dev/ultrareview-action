// ---------------------------------------------------------------------------
// deletion-detector.ts — Classify deleted lines in PR diffs by risk level
// ---------------------------------------------------------------------------

import type { ReviewFile } from './context-gatherer.ts'

export type DeletionRisk = 'high' | 'medium' | 'low'

export type DeletionIssue = {
  file: string
  line: number
  risk: DeletionRisk
  category: string
  description: string
  deletedCode: string
}

const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\btry\s*\{/, category: 'error-handling' },
  { pattern: /\bcatch\s*\(/, category: 'error-handling' },
  { pattern: /\bthrow\s+/, category: 'error-handling' },
  { pattern: /\bauth(?:enticate|orize|orization|Check|Guard|Middleware)\b/i, category: 'auth-check' },
  { pattern: /\bpermission/i, category: 'auth-check' },
  { pattern: /\bisAuthorized|isAuthenticated|requireAuth/, category: 'auth-check' },
  { pattern: /\bvalidate|sanitize|escape/i, category: 'validation' },
  { pattern: /\bif\s*\(\s*!/, category: 'guard-clause' },
  { pattern: /\?\?/, category: 'null-safety' },
  { pattern: /\.catch\s*\(/, category: 'error-handling' },
]

const MEDIUM_RISK_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\bfallback|default/i, category: 'fallback' },
  { pattern: /\blogger\.|console\.(error|warn)/, category: 'logging' },
  { pattern: /\btimeout|retry|backoff/i, category: 'resilience' },
  { pattern: /\bfinally\s*\{/, category: 'cleanup' },
]

const LOW_RISK_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /^\s*\/\//, category: 'comment' },
  { pattern: /^\s*\/?\*/, category: 'comment' },
  { pattern: /^\s*import\s+/, category: 'unused-import' },
  { pattern: /^\s*$/, category: 'whitespace' },
]

export function classifyDeletion(line: string): { risk: DeletionRisk; category: string } {
  for (const { pattern, category } of HIGH_RISK_PATTERNS) {
    if (pattern.test(line)) return { risk: 'high', category }
  }
  for (const { pattern, category } of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(line)) return { risk: 'medium', category }
  }
  for (const { pattern, category } of LOW_RISK_PATTERNS) {
    if (pattern.test(line)) return { risk: 'low', category }
  }
  return { risk: 'low', category: 'other' }
}

export function extractDeletions(
  hunkContent: string,
  oldStart: number,
): Array<{ line: number; code: string }> {
  let lineNum = oldStart
  return hunkContent
    .split('\n')
    .flatMap((raw) => {
      if (raw.startsWith('---')) return []
      if (raw.startsWith('-')) {
        const entry = { line: lineNum, code: raw.slice(1) }
        lineNum++
        return [entry]
      }
      if (!raw.startsWith('+')) lineNum++
      return []
    })
}

type RawDeletion = { line: number; code: string; risk: DeletionRisk; category: string }

export function groupConsecutiveDeletions(deletions: RawDeletion[]): DeletionIssue[] {
  const issues: DeletionIssue[] = []
  let i = 0
  while (i < deletions.length) {
    const start = deletions[i]!
    const group: RawDeletion[] = [start]
    let next = deletions[i + group.length]
    while (
      next &&
      next.line === start.line + group.length &&
      next.risk === start.risk &&
      next.category === start.category
    ) {
      group.push(next)
      next = deletions[i + group.length]
    }
    issues.push({
      file: '',
      line: start.line,
      risk: start.risk,
      category: start.category,
      description: `Removed ${start.category} code`,
      deletedCode: group.map((d) => d.code).join('\n'),
    })
    i += group.length
  }
  return issues
}

export function detectDeletionRisks(files: ReviewFile[]): DeletionIssue[] {
  const results: DeletionIssue[] = []
  for (const { diffFile } of files) {
    const path = diffFile.path
    if (/(__tests__|\.test\.|\.spec\.)/.test(path)) continue
    for (const hunk of diffFile.hunks) {
      const raw = extractDeletions(hunk.content, hunk.oldStart)
      const classified = raw
        .map((d) => ({ ...d, ...classifyDeletion(d.code) }))
        .filter((d) => d.risk !== 'low')
      const grouped = groupConsecutiveDeletions(classified)
      results.push(...grouped.map((issue) => ({ ...issue, file: path })))
    }
  }
  return results
}

export function formatDeletionContext(issues: DeletionIssue[]): string {
  if (issues.length === 0) return ''
  const byFile = new Map<string, DeletionIssue[]>()
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? []
    list.push(issue)
    byFile.set(issue.file, list)
  }
  const lines = ['## RISKY DELETIONS DETECTED']
  for (const [file, fileIssues] of byFile) {
    lines.push(`### ${file}`)
    for (const issue of fileIssues) {
      lines.push(`- [line ${issue.line}] ${issue.risk.toUpperCase()} ${issue.category}: ${issue.description}`)
      lines.push(`  \`${issue.deletedCode.replace(/\n/g, ' | ')}\``)
    }
  }
  return lines.join('\n')
}
