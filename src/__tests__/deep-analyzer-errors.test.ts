import { test, expect, describe, mock, afterEach } from 'bun:test'
import { analyzeFile, analyzeAllFiles } from '../agent/deep-analyzer.ts'
import { runAgentLoop } from '../agent/agent-loop.ts'
import type { ReviewFile } from '../agent/context-gatherer.ts'

// Mock ReviewFile helper
const createMockFile = (path: string): ReviewFile => ({
  diffFile: {
    path,
    hunks: [],
    additions: 1,
    deletions: 0,
    isNew: true,
    isDeleted: false,
  },
  context: {
    path,
    content: '',
    imports: [],
    importContents: new Map(),
    testFiles: [],
    testContents: new Map(),
    callers: [],
  },
})

describe('deep-analyzer errors', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('analyzeFile propagates error when AI call fails', async () => {
    global.fetch = mock(() => {
      return Promise.resolve(new Response('Unauthorized', { status: 401 }))
    }) as any

    const mockFile = createMockFile('src/index.ts')
    await expect(analyzeFile(mockFile)).rejects.toThrow('AI API error 401')
  })

  test('analyzeAllFiles throws immediately on 401/403 authentication error', async () => {
    global.fetch = mock(() => {
      return Promise.resolve(new Response('Unauthorized', { status: 401 }))
    }) as any

    const files = [createMockFile('src/a.ts'), createMockFile('src/b.ts')]
    await expect(analyzeAllFiles(files)).rejects.toThrow('AI API error 401')
  })

  test('analyzeAllFiles throws when 100% of files fail with generic error', async () => {
    global.fetch = mock(() => {
      return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
    }) as any

    const files = [createMockFile('src/a.ts'), createMockFile('src/b.ts')]
    await expect(analyzeAllFiles(files)).rejects.toThrow('All file analyses failed')
  })

  test('analyzeAllFiles tolerates partial failures (some succeed, some fail with generic error)', async () => {
    let callCount = 0
    global.fetch = mock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(new Response('Internal Error', { status: 500 }))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '[]' }, finish_reason: 'stop' }],
          }),
        ),
      )
    }) as any

    const files = [createMockFile('src/failed.ts'), createMockFile('src/succeeded.ts')]
    const bugs = await analyzeAllFiles(files)
    expect(bugs).toEqual([]) // Should succeed and return empty bugs list instead of throwing
  })

  test('runAgentLoop propagates analyzing step failures', async () => {
    global.fetch = mock(() => {
      return Promise.resolve(new Response('Unauthorized', { status: 401 }))
    }) as any

    // Simple diff representing a changed file
    const diff = 'diff --git a/src/a.ts b/src/a.ts\nindex 0000000..1111111\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n+const x = 1;'
    
    // runAgentLoop should throw the propagated 401 error
    await expect(runAgentLoop(diff, process.cwd())).rejects.toThrow('AI API error 401')
  })
})
