// ---------------------------------------------------------------------------
// async-tracer.ts — Static regex analysis of async patterns in changed files
// Detects: unawaited calls, uncaught promises, fire-and-forget in loops
// ---------------------------------------------------------------------------

import type { ReviewFile } from './context-gatherer.ts'

export type AsyncIssueKind = 'unawaited-async' | 'uncaught-promise' | 'fire-and-forget-loop'

export type AsyncIssue = {
  file: string
  line: number
  kind: AsyncIssueKind
  severity: 'high' | 'medium'
  description: string
  evidence: string
  calledFunction: string
}

const ALLOWED_FIRE_AND_FORGET = new Set([
  'console.log', 'console.error', 'console.warn',
  'logger.info', 'logger.error', 'logger.warn', 'logger.debug',
  'emit', 'removeListener', 'on',
  'track', 'analytics',
])

// Matches: async function foo, foo = async (, async foo(
const ASYNC_FN_RE = /(?:async\s+function\s+(\w+)|(\w+)\s*=\s*async\s*(?:\(|=>)|async\s+(\w+)\s*\()/g

export function findAsyncFunctions(content: string): Array<{ name: string; line: number }> {
  const results: Array<{ name: string; line: number }> = []
  const seen = new Set<string>()
  const lines = content.split('\n')
  lines.forEach((lineText, idx) => {
    let m: RegExpExecArray | null
    const re = new RegExp(ASYNC_FN_RE.source, 'g')
    while ((m = re.exec(lineText)) !== null) {
      const name = m[1] ?? m[2] ?? m[3]
      if (name && !seen.has(name)) {
        seen.add(name)
        results.push({ name, line: idx + 1 })
      }
    }
  })
  return results
}

export function findUnawaitedCalls(
  lines: string[],
  asyncFuncNames: Set<string>,
  filePath: string,
): AsyncIssue[] {
  const issues: AsyncIssue[] = []
  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim()
    // Skip: already awaited, assignment, .then chains, comments
    if (/^\s*\/\//.test(lineText)) return
    if (/\bawait\b/.test(trimmed)) return
    if (/\.then\(/.test(trimmed)) return
    if (/(?:const|let|var)\s+\w+\s*=/.test(trimmed)) return
    if (/\breturn\b/.test(trimmed)) return

    for (const fnName of asyncFuncNames) {
      if (ALLOWED_FIRE_AND_FORGET.has(fnName)) continue
      const callRe = new RegExp(`\\b${fnName}\\s*\\(`)
      if (callRe.test(trimmed)) {
        issues.push({
          file: filePath, line: idx + 1, kind: 'unawaited-async', severity: 'high',
          description: `Async function '${fnName}' called without await`,
          evidence: lineText.trim(), calledFunction: fnName,
        })
      }
    }
  })
  return issues
}

export function findUncaughtPromises(lines: string[], filePath: string): AsyncIssue[] {
  const issues: AsyncIssue[] = []
  lines.forEach((lineText, idx) => {
    if (!lineText.includes('.then(')) return
    // Look ahead up to 3 lines for .catch(
    const window = lines.slice(idx, idx + 4).join(' ')
    if (!window.includes('.catch(')) {
      const fnMatch = lineText.match(/(\w+)\.then\(/)
      issues.push({
        file: filePath, line: idx + 1, kind: 'uncaught-promise', severity: 'medium',
        description: '.then() chain missing .catch() handler',
        evidence: lineText.trim(), calledFunction: fnMatch?.[1] ?? 'unknown',
      })
    }
  })
  return issues
}

export function findFireAndForgetLoops(
  lines: string[],
  asyncFuncNames: Set<string>,
  filePath: string,
): AsyncIssue[] {
  const issues: AsyncIssue[] = []
  let loopDepth = 0
  let loopBraces = 0

  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim()
    if (/\b(?:for|forEach|\.map)\b.*[({]/.test(trimmed)) { loopDepth++; loopBraces = 0 }
    loopBraces += (trimmed.match(/\{/g) ?? []).length
    loopBraces -= (trimmed.match(/\}/g) ?? []).length
    if (loopDepth > 0 && loopBraces <= 0) { loopDepth = Math.max(0, loopDepth - 1) }
    if (loopDepth === 0) return
    if (/\bawait\b/.test(trimmed)) return

    for (const fnName of asyncFuncNames) {
      if (ALLOWED_FIRE_AND_FORGET.has(fnName)) continue
      const callRe = new RegExp(`\\b${fnName}\\s*\\(`)
      if (callRe.test(trimmed)) {
        issues.push({
          file: filePath, line: idx + 1, kind: 'fire-and-forget-loop', severity: 'high',
          description: `Async call '${fnName}' inside loop without await — potential race condition`,
          evidence: lineText.trim(), calledFunction: fnName,
        })
      }
    }
  })
  return issues
}

export function traceAsyncIssues(files: ReviewFile[]): AsyncIssue[] {
  // Collect all async function names across all files first
  const globalAsyncNames = new Set<string>()
  for (const { context } of files) {
    findAsyncFunctions(context.content).forEach(({ name }) => globalAsyncNames.add(name))
  }

  const allIssues: AsyncIssue[] = []
  const seen = new Set<string>()

  for (const { diffFile, context } of files) {
    const filePath = diffFile.path
    const lines = context.content.split('\n')
    const candidates = [
      ...findUnawaitedCalls(lines, globalAsyncNames, filePath),
      ...findUncaughtPromises(lines, filePath),
      ...findFireAndForgetLoops(lines, globalAsyncNames, filePath),
    ]
    for (const issue of candidates) {
      const key = `${issue.file}:${issue.line}:${issue.kind}`
      if (!seen.has(key)) { seen.add(key); allIssues.push(issue) }
    }
  }

  return allIssues
}

export function formatAsyncContext(issues: AsyncIssue[]): string {
  if (issues.length === 0) return ''
  const lines = ['## ASYNC ISSUES DETECTED']
  for (const issue of issues) {
    lines.push(`- [${issue.file}:${issue.line}] **${issue.kind}** (${issue.severity}): ${issue.description}`)
    lines.push(`  \`${issue.evidence}\``)
  }
  return lines.join('\n')
}
