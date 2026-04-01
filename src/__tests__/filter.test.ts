import { test, expect, describe } from 'bun:test'
import { filterBugs } from '../agent/filter.ts'
import type { JudgedBug } from '../agent/judge.ts'

const makeBug = (overrides: Partial<JudgedBug> = {}): JudgedBug => ({
  file: 'src/main.ts',
  line: 10,
  title: 'Test bug',
  description: 'Test',
  suggestion: 'Fix it',
  evidence: 'const x = null; x.foo()',
  severity: 'high',
  category: 'logic',
  confidence: 0.8,
  judgeScore: 0.7,
  adjustedSeverity: 'high',
  verified: true,
  verificationEvidence: 'test',
  evidenceMatch: true,
  symbolsVerified: true,
  domain: 'logic',
  bugType: 'null-reference',
  classificationConfidence: 0.8,
  judgeReasoning: 'test',
  ...overrides,
})

describe('filter', () => {
  test('filters bugs below confidence threshold', () => {
    const bugs: JudgedBug[] = [
      makeBug({ title: 'High confidence bug', confidence: 0.8, judgeScore: 0.7 }),
      makeBug({ title: 'Low confidence bug', line: 20, confidence: 0.5, judgeScore: 0.8 }),
    ]

    const result = filterBugs(bugs)
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe('High confidence bug')
  })

  test('filters bugs below judge score threshold', () => {
    const bugs: JudgedBug[] = [
      makeBug({ title: 'High judge score', confidence: 0.8, judgeScore: 0.7 }),
      makeBug({ title: 'Low judge score', line: 20, confidence: 0.8, judgeScore: 0.4 }),
    ]

    const result = filterBugs(bugs)
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe('High judge score')
  })

  test('sorts bugs by severity: critical > high > medium > low', () => {
    const bugs: JudgedBug[] = [
      makeBug({ severity: 'low', line: 10, title: 'Low severity', adjustedSeverity: 'low' }),
      makeBug({ severity: 'critical', line: 20, title: 'Critical severity', adjustedSeverity: 'critical' }),
      makeBug({ severity: 'medium', line: 30, title: 'Medium severity', adjustedSeverity: 'medium' }),
      makeBug({ severity: 'high', line: 40, title: 'High severity', adjustedSeverity: 'high' }),
    ]

    const result = filterBugs(bugs)
    expect(result).toHaveLength(4)
    expect(result[0]?.severity).toBe('critical')
    expect(result[1]?.severity).toBe('high')
    expect(result[2]?.severity).toBe('medium')
    expect(result[3]?.severity).toBe('low')
  })

  test('empty input returns empty output', () => {
    const result = filterBugs([])
    expect(result).toEqual([])
  })

  test('marks all passing bugs as verified=true', () => {
    const bugs: JudgedBug[] = [makeBug({ confidence: 0.8, judgeScore: 0.7 })]

    const result = filterBugs(bugs)
    expect(result[0]?.verified).toBe(true)
  })

  test('respects custom thresholds', () => {
    const bugs: JudgedBug[] = [
      makeBug({ confidence: 0.5, judgeScore: 0.5, title: 'Bug1', line: 10 }),
      makeBug({ confidence: 0.9, judgeScore: 0.9, title: 'Bug2', line: 20 }),
    ]

    const result = filterBugs(bugs, { minConfidence: 0.4, minJudgeScore: 0.4 })
    expect(result).toHaveLength(2)
  })

  test('converts JudgedBug to Bug type correctly', () => {
    const bugs: JudgedBug[] = [
      makeBug({
        file: 'src/main.ts',
        line: 42,
        title: 'My bug',
        description: 'Description',
        suggestion: 'Fix suggestion',
        severity: 'high',
        adjustedSeverity: 'high',
      }),
    ]

    const result = filterBugs(bugs)
    expect(result[0]?.file).toBe('src/main.ts')
    expect(result[0]?.line).toBe(42)
    expect(result[0]?.title).toBe('My bug')
    expect(result[0]?.description).toBe('Description')
    expect(result[0]?.suggestion).toBe('Fix suggestion')
    expect(result[0]?.severity).toBe('high')
  })

  test('filters at both confidence and judge score thresholds', () => {
    const bugs: JudgedBug[] = [
      makeBug({ confidence: 0.75, judgeScore: 0.65, title: 'Both pass', line: 1 }),
      makeBug({ confidence: 0.65, judgeScore: 0.75, title: 'Confidence fails', line: 2 }),
      makeBug({ confidence: 0.75, judgeScore: 0.55, title: 'Judge fails', line: 3 }),
    ]

    const result = filterBugs(bugs)
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe('Both pass')
  })
})
