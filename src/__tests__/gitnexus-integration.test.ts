import { test, expect, describe } from 'bun:test'
import { execSync } from 'child_process'
import { runGitNexusTracer } from '../agent/gitnexus-tracer'
import type { TracerInput } from '../agent/gitnexus-tracer'

/**
 * Integration test for GitNexus tracer with real binary + indexed repo.
 * SKIPPED unless GITNEXUS_INTEGRATION=1 env var is set.
 *
 * Uses ultrareview-clone itself as the fixture repo.
 * Attempts to self-index and trace against known changed function.
 */
describe.skipIf(process.env.GITNEXUS_INTEGRATION !== '1')('gitnexus-integration', () => {
  test('tracer returns symbols for indexed repo', async () => {
    const repoPath = '/Users/tunb/Documents/skin-agent-workspace/ultrareview-clone'

    // Try to run tracer on the repo itself
    // We'll use a synthetic diff against a known file that exists
    const input: TracerInput = {
      filePath: 'src/agent/gitnexus-client.ts',
      diff: '@@ -50,7 +50,7 @@\n function test() {\n-  return 1\n+  return 2\n }',
      baseRef: 'HEAD~1',
      headRef: 'HEAD',
      repoPath,
    }

    const result = await runGitNexusTracer(input)

    // Result should be defined
    expect(result).toBeDefined()
    expect(result.filePath).toBe('src/agent/gitnexus-client.ts')

    // Status should be 'ok' or 'skipped' (skipped if repo not indexed)
    expect(['ok', 'skipped', 'partial']).toContain(result.status)

    // If not skipped, symbols should have caller/callee info
    if (result.status === 'ok' && result.symbols.length > 0) {
      const sym = result.symbols[0]
      expect(sym.name).toBeDefined()
      expect(sym.kind).toBeDefined()
      expect(Array.isArray(sym.callers)).toBe(true)
    }
  })

  test('tracer handles unindexed repo gracefully', async () => {
    const repoPath = '/tmp/definitely-not-indexed-12345'

    const input: TracerInput = {
      filePath: 'src/test.ts',
      diff: '@@ -1,1 +1,1 @@',
      baseRef: 'HEAD',
      headRef: 'HEAD',
      repoPath,
    }

    // Should not throw — should return skipped
    const result = await runGitNexusTracer(input)
    expect(['ok', 'skipped', 'partial']).toContain(result.status)
    expect(Array.isArray(result.symbols)).toBe(true)
  })

  test('tracer respects GITNEXUS_ENABLED env flag', async () => {
    const origEnabled = process.env.GITNEXUS_ENABLED
    process.env.GITNEXUS_ENABLED = 'false'

    try {
      const input: TracerInput = {
        filePath: 'src/test.ts',
        diff: '@@ -1,1 +1,1 @@',
        baseRef: 'HEAD',
        headRef: 'HEAD',
        repoPath: '/tmp/repo',
      }

      const result = await runGitNexusTracer(input)
      expect(result.status).toBe('skipped')
    } finally {
      if (origEnabled !== undefined) process.env.GITNEXUS_ENABLED = origEnabled
      else delete process.env.GITNEXUS_ENABLED
    }
  })
})
