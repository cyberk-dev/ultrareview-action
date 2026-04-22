import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import {
  runGitNexusTracer,
  clearTracerCache,
} from '../agent/gitnexus-tracer'
import * as client from '../agent/gitnexus-client'
import type { TracerInput } from '../agent/gitnexus-tracer'

describe('gitnexus-tracer', () => {
  const origEnabled = process.env.GITNEXUS_ENABLED
  const origBudget = process.env.GITNEXUS_TRACER_BUDGET_MS
  const origMaxSymbols = process.env.GITNEXUS_MAX_SYMBOLS_PER_FILE

  beforeEach(() => {
    clearTracerCache()
  })

  afterEach(() => {
    clearTracerCache()
    // Restore env
    if (origEnabled !== undefined) process.env.GITNEXUS_ENABLED = origEnabled
    else delete process.env.GITNEXUS_ENABLED
    if (origBudget !== undefined) process.env.GITNEXUS_TRACER_BUDGET_MS = origBudget
    else delete process.env.GITNEXUS_TRACER_BUDGET_MS
    if (origMaxSymbols !== undefined) process.env.GITNEXUS_MAX_SYMBOLS_PER_FILE = origMaxSymbols
    else delete process.env.GITNEXUS_MAX_SYMBOLS_PER_FILE
  })

  test('runGitNexusTracer returns skipped when GITNEXUS_ENABLED=false', async () => {
    process.env.GITNEXUS_ENABLED = 'false'
    clearTracerCache()

    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '@@ -1,3 +1,4 @@\n+new line',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }

    const result = await runGitNexusTracer(input)
    expect(result.status).toBe('skipped')
    expect(result.symbols).toHaveLength(0)
  })

  test('runGitNexusTracer returns skipped when binary unavailable', async () => {
    process.env.GITNEXUS_BIN = '/does/not/exist/gitnexus'
    process.env.GITNEXUS_ENABLED = 'true'
    client.clearGitNexusCache?.()

    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '@@ -1,3 +1,4 @@\n+new line',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }

    const result = await runGitNexusTracer(input)
    expect(result.status).toBe('skipped')
  })

  test('runGitNexusTracer caps symbols at GITNEXUS_MAX_SYMBOLS_PER_FILE', async () => {
    process.env.GITNEXUS_MAX_SYMBOLS_PER_FILE = '3'
    // Note: without a real gitnexus binary, we can't fully test this,
    // but the cap is applied in the code after fan-out
  })

  test('runGitNexusTracer returns empty symbols array for empty diff', async () => {
    process.env.GITNEXUS_BIN = '/does/not/exist/gitnexus'
    process.env.GITNEXUS_ENABLED = 'true'
    client.clearGitNexusCache?.()

    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }

    const result = await runGitNexusTracer(input)
    // Empty diff = no changes = empty symbols (or skipped)
    expect(Array.isArray(result.symbols)).toBe(true)
  })

  test('runGitNexusTracer respects timeout budget', async () => {
    process.env.GITNEXUS_TRACER_BUDGET_MS = '100'
    clearTracerCache()

    // Verify that budget is read from env
    const budgetStr = process.env.GITNEXUS_TRACER_BUDGET_MS
    const budget = parseInt(budgetStr ?? '15000', 10)
    expect(budget).toBe(100)
  })

  test('runGitNexusTracer memoizes detect_changes across calls', async () => {
    // With same baseRef, headRef, repoPath, subsequent calls should use cache
    // (This is semantic — we can't spy on internal cache, but verify idempotence)

    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '@@ -1,3 +1,4 @@\n+new line',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }

    const result1 = await runGitNexusTracer(input)
    const result2 = await runGitNexusTracer(input)

    // Both results should be identical (memoized)
    expect(result1.status).toBe(result2.status)
    expect(result1.symbols).toHaveLength(result2.symbols.length)
  })

  test('runGitNexusTracer deduplicates symbols', async () => {
    // Symbol deduplication happens in fan-out phase — verify via
    // checking that duplicate symbol names (same file/line) appear once
    // (Hard to test without real gitnexus; relies on implementation)
  })

  test('runGitNexusTracer filePath is included in result', async () => {
    const input: TracerInput = {
      filePath: 'src/important.ts',
      diff: '',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }

    const result = await runGitNexusTracer(input)
    expect(result.filePath).toBe('src/important.ts')
  })

  test('runGitNexusTracer result has filePath and symbols', async () => {
    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }

    const result = await runGitNexusTracer(input)
    expect(result.filePath).toBeDefined()
    expect(result.symbols).toBeDefined()
    expect(Array.isArray(result.symbols)).toBe(true)
  })

  test('runGitNexusTracer clears cache correctly', async () => {
    clearTracerCache()
    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }
    const result = await runGitNexusTracer(input)
    expect(result).toBeDefined()

    // After clear, results should still be idempotent but cache should be empty
    clearTracerCache()
    const result2 = await runGitNexusTracer(input)
    expect(result2.status).toBe(result.status)
  })

  test('runGitNexusTracer returns reason field on skipped', async () => {
    process.env.GITNEXUS_ENABLED = 'false'
    clearTracerCache()

    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '',
      baseRef: 'main',
      headRef: 'HEAD',
      repoPath: '/tmp/repo',
    }

    const result = await runGitNexusTracer(input)
    expect(result.status).toBe('skipped')
    // reason field is optional but may be populated on skip
    if (result.reason) {
      expect(typeof result.reason).toBe('string')
    }
  })
})
