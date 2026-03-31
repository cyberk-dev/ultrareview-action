import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { runBugHunterFleet } from '../utils/mock-fleet.ts'

describe('mock-fleet', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('runBugHunterFleet returns empty array for empty diff', async () => {
    const result = await runBugHunterFleet('', '')
    expect(result.bugs.length).toBe(0)
    expect(result.duration).toBe(0)
  })

  test('runBugHunterFleet returns empty array for whitespace-only diff', async () => {
    const result = await runBugHunterFleet('   \n\n  ', '')
    expect(result.bugs.length).toBe(0)
  })

  test('runBugHunterFleet returns structure with bugs and duration', async () => {
    const result = await runBugHunterFleet('', '')
    expect(result).toHaveProperty('bugs')
    expect(result).toHaveProperty('duration')
    expect(Array.isArray(result.bugs)).toBe(true)
    expect(typeof result.duration).toBe('number')
  })

  test('runBugHunterFleet preserves Bug type structure', async () => {
    const result = await runBugHunterFleet('', '')
    // Verify structure even with empty result
    expect(Array.isArray(result.bugs)).toBe(true)
    if (result.bugs.length > 0) {
      const bug = result.bugs[0]
      expect(bug).toHaveProperty('severity')
      expect(['critical', 'high', 'medium', 'low']).toContain(bug!.severity)
      expect(bug).toHaveProperty('file')
      expect(bug).toHaveProperty('title')
      expect(bug).toHaveProperty('description')
      expect(bug).toHaveProperty('suggestion')
      expect(bug).toHaveProperty('verified')
    }
  })
})
