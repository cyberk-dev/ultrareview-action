import { test, expect, describe } from 'bun:test'
import { matchBugs } from '../eval/bug-matcher.ts'
import type { Bug } from '../utils/mock-fleet.ts'
import type { InjectedBug } from '../eval/bug-matcher.ts'

describe('bug-matcher', () => {
  test('perfect match: same file and line returns TP=1, FP=0, FN=0', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: 'src/main.ts',
        line: 10,
        title: 'Null reference',
        description: 'Missing null check',
        suggestion: 'Add null check',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 10,
        severity: 'high',
        category: 'logic',
        title: 'Null reference',
        description: 'Missing null check',
      },
    ]

    const result = matchBugs(found, truth)
    expect(result.truePositives).toBe(1)
    expect(result.falsePositives).toBe(0)
    expect(result.falseNegatives).toBe(0)
    expect(result.precision).toBe(1)
    expect(result.recall).toBe(1)
    expect(result.f1).toBe(1)
  })

  test('fuzzy match: same file, line ±3 still matches', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: 'src/main.ts',
        line: 12,
        title: 'Bug',
        description: 'Test',
        suggestion: 'Fix it',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 10,
        severity: 'high',
        category: 'logic',
        title: 'Bug',
        description: 'Test',
      },
    ]

    const result = matchBugs(found, truth)
    expect(result.truePositives).toBe(1)
    expect(result.falsePositives).toBe(0)
    expect(result.falseNegatives).toBe(0)
  })

  test('no match: different file returns FP=1, FN=1', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: 'src/wrong.ts',
        line: 10,
        title: 'Bug',
        description: 'Test',
        suggestion: 'Fix it',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 10,
        severity: 'high',
        category: 'logic',
        title: 'Bug',
        description: 'Test',
      },
    ]

    const result = matchBugs(found, truth)
    expect(result.truePositives).toBe(0)
    expect(result.falsePositives).toBe(1)
    expect(result.falseNegatives).toBe(1)
    expect(result.precision).toBe(0)
    expect(result.recall).toBe(0)
  })

  test('empty found bugs returns only FN', () => {
    const found: Bug[] = []

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 10,
        severity: 'high',
        category: 'logic',
        title: 'Bug',
        description: 'Test',
      },
    ]

    const result = matchBugs(found, truth)
    expect(result.truePositives).toBe(0)
    expect(result.falsePositives).toBe(0)
    expect(result.falseNegatives).toBe(1)
    expect(result.precision).toBe(1) // 0 / 0 = 1 by default
    expect(result.recall).toBe(0)
  })

  test('empty truth returns only FP', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: 'src/main.ts',
        line: 10,
        title: 'Bug',
        description: 'Test',
        suggestion: 'Fix it',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = []

    const result = matchBugs(found, truth)
    expect(result.truePositives).toBe(0)
    expect(result.falsePositives).toBe(1)
    expect(result.falseNegatives).toBe(0)
    expect(result.precision).toBe(0)
    expect(result.recall).toBe(1) // 0 / 0 = 1 by default
  })

  test('multiple matches: greedy closest-line-first', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: 'src/main.ts',
        line: 20,
        title: 'Bug1',
        description: 'Test',
        suggestion: 'Fix it',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 18,
        severity: 'high',
        category: 'logic',
        title: 'Bug1',
        description: 'Test',
      },
      {
        file: 'src/main.ts',
        line: 25,
        severity: 'high',
        category: 'logic',
        title: 'Bug2',
        description: 'Test',
      },
    ]

    const result = matchBugs(found, truth)
    // Line 20 is closer to 18 (distance 2) than to 25 (distance 5)
    expect(result.truePositives).toBe(1)
    expect(result.falseNegatives).toBe(1)
  })

  test('file path normalization: ./src/main.ts matches src/main.ts', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: './src/main.ts',
        line: 10,
        title: 'Bug',
        description: 'Test',
        suggestion: 'Fix it',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 10,
        severity: 'high',
        category: 'logic',
        title: 'Bug',
        description: 'Test',
      },
    ]

    const result = matchBugs(found, truth)
    expect(result.truePositives).toBe(1)
  })

  test('line out of tolerance: line >5 away does not match', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: 'src/main.ts',
        line: 20,
        title: 'Bug',
        description: 'Test',
        suggestion: 'Fix it',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 10,
        severity: 'high',
        category: 'logic',
        title: 'Bug',
        description: 'Test',
      },
    ]

    const result = matchBugs(found, truth)
    expect(result.truePositives).toBe(0)
    expect(result.falsePositives).toBe(1)
    expect(result.falseNegatives).toBe(1)
  })

  test('returns match list with found and truth bugs', () => {
    const found: Bug[] = [
      {
        severity: 'high',
        file: 'src/main.ts',
        line: 10,
        title: 'Bug',
        description: 'Test',
        suggestion: 'Fix it',
        verified: true,
      },
    ]

    const truth: InjectedBug[] = [
      {
        file: 'src/main.ts',
        line: 10,
        severity: 'high',
        category: 'logic',
        title: 'Bug',
        description: 'Test',
      },
    ]

    const result = matchBugs(found, truth)
    expect(Array.isArray(result.matches)).toBe(true)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.found).toBeDefined()
    expect(result.matches[0]?.truth).toBeDefined()
  })
})
