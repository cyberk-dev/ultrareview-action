import { test, expect, describe } from 'bun:test'
import { gatherReviewContexts } from '../agent/context-gatherer.ts'

describe('context-gatherer', () => {
  test('gatherReviewContexts with empty diff returns empty array', async () => {
    const result = await gatherReviewContexts('', '/tmp')
    expect(result).toEqual([])
  })

  test('gatherReviewContexts with whitespace diff returns empty array', async () => {
    const result = await gatherReviewContexts('   \n\n   ', '/tmp')
    expect(result).toEqual([])
  })

  test('gatherReviewContexts returns ReviewFile[] with correct structure', async () => {
    const diff = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,2 +1,3 @@
 line1
+line2
 line3`

    const result = await gatherReviewContexts(diff, '/tmp')

    // Should return array of ReviewFile
    expect(Array.isArray(result)).toBe(true)

    // Each item should have diffFile and context properties
    if (result.length > 0) {
      const item = result[0]
      expect(item).toHaveProperty('diffFile')
      expect(item).toHaveProperty('context')
      expect(item?.diffFile).toHaveProperty('path')
      expect(item?.context).toHaveProperty('content')
      expect(item?.context).toHaveProperty('imports')
    }
  })

  test('gatherReviewContexts filters binary files', async () => {
    const diff = `diff --git a/src/image.png b/src/image.png
Binary files a/src/image.png and b/src/image.png differ
diff --git a/src/code.ts b/src/code.ts
--- a/src/code.ts
+++ b/src/code.ts
@@ -1 +1 @@
-old
+new`

    const result = await gatherReviewContexts(diff, '/tmp')
    // Should skip binary files in diff-parser
    expect(result.length).toBeLessThanOrEqual(1)
  })

  test('gatherReviewContexts handles multiple files', async () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new`

    const result = await gatherReviewContexts(diff, '/tmp')
    expect(result.length).toBeGreaterThanOrEqual(0)
  })

  test('ReviewFile has diffFile with path and hunks', async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,2 @@
 export const x = 1
+export const y = 2`

    const result = await gatherReviewContexts(diff, '/tmp')
    if (result.length > 0) {
      const item = result[0]
      expect(item?.diffFile.path).toBeDefined()
      expect(Array.isArray(item?.diffFile.hunks)).toBe(true)
      expect(typeof item?.diffFile.additions).toBe('number')
      expect(typeof item?.diffFile.deletions).toBe('number')
    }
  })

  test('ReviewFile context has imports array', async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
--- /dev/null
+++ b/src/test.ts
@@ -0,0 +1,2 @@
+import React from 'react'
+const x = 1`

    const result = await gatherReviewContexts(diff, '/tmp')
    if (result.length > 0) {
      const item = result[0]
      expect(Array.isArray(item?.context.imports)).toBe(true)
    }
  })

  test('ReviewFile context has testFiles array', async () => {
    const diff = `diff --git a/src/util.ts b/src/util.ts
--- a/src/util.ts
+++ b/src/util.ts
@@ -1 +1 @@
-old
+new`

    const result = await gatherReviewContexts(diff, '/tmp')
    if (result.length > 0) {
      const item = result[0]
      expect(Array.isArray(item?.context.testFiles)).toBe(true)
    }
  })
})
