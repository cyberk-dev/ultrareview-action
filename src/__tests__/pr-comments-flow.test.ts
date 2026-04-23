import { test, expect, describe } from 'bun:test'
import { buildReviewSummary, buildFlowDiagramBlock } from '../github/pr-comments'
import type { Bug } from '../utils/mock-fleet'

const SAMPLE_BUG: Bug = {
  severity: 'high',
  file: 'src/auth.ts',
  line: 42,
  title: 'null deref',
  description: 'desc',
  suggestion: 'fix',
  verified: true,
}

const VALID_DIAGRAM = '```mermaid\nflowchart TD\n    A --> B\n```'

describe('buildFlowDiagramBlock', () => {
  test('empty/undefined → returns ""', () => {
    expect(buildFlowDiagramBlock(undefined)).toBe('')
    expect(buildFlowDiagramBlock('')).toBe('')
    expect(buildFlowDiagramBlock('   ')).toBe('')
  })

  test('valid diagram → wraps in <details> with caveat', () => {
    const out = buildFlowDiagramBlock(VALID_DIAGRAM)
    expect(out).toContain('<details>')
    expect(out).toContain('</details>')
    expect(out).toContain("Bot's understanding")
    expect(out).toContain('flowchart TD')
    expect(out).toContain('Verify against actual code')
  })
})

describe('buildReviewSummary — flow diagram embed', () => {
  test('no flowDiagram → existing format unchanged', () => {
    const out = buildReviewSummary([SAMPLE_BUG], 1234)
    expect(out).not.toContain('<details>')
    expect(out).toContain('## 🔍 Ultrareview Results')
    expect(out.startsWith('## 🔍')).toBe(true)
  })

  test('with flowDiagram → <details> block prepended', () => {
    const out = buildReviewSummary([SAMPLE_BUG], 1234, VALID_DIAGRAM)
    expect(out.startsWith('<details>')).toBe(true)
    expect(out).toContain('flowchart TD')
    expect(out).toContain('## 🔍 Ultrareview Results')
    // Diagram appears BEFORE the results table
    expect(out.indexOf('<details>')).toBeLessThan(out.indexOf('## 🔍'))
  })

  test('summary still contains all expected metrics with diagram', () => {
    const out = buildReviewSummary([SAMPLE_BUG], 5000, VALID_DIAGRAM)
    expect(out).toContain('| Bugs found | 1 |')
    expect(out).toContain('| Verified | 1 |')
    expect(out).toContain('| Duration | 5.0s |')
    expect(out).toContain('🟠 High: 1')
  })
})
