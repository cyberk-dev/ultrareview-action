// ---------------------------------------------------------------------------
// context-gatherer.ts — Orchestrate diff parsing + file context gathering
// ---------------------------------------------------------------------------

import { parseDiff } from '../github/diff-parser.ts'
import { gatherFileContext } from '../utils/file-reader.ts'
import type { DiffFile } from '../github/diff-parser.ts'
import type { FileContext } from '../utils/file-reader.ts'

/** Concurrency limit for parallel context gathering */
const CONCURRENCY = 5

export type ReviewFile = {
  diffFile: DiffFile
  context: FileContext
}

/**
 * Parse diff + gather full context for each changed file.
 * Skips binary, generated, and lock files (handled by parseDiff).
 * Runs context gathering in parallel with concurrency limit.
 */
export async function gatherReviewContexts(
  diffText: string,
  repoRoot: string,
): Promise<ReviewFile[]> {
  const diffFiles = parseDiff(diffText)

  if (diffFiles.length === 0) return []

  // Process in batches of CONCURRENCY
  const results: ReviewFile[] = []

  for (let i = 0; i < diffFiles.length; i += CONCURRENCY) {
    const batch = diffFiles.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map((diffFile) => gatherContextForFile(diffFile, repoRoot)),
    )

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value)
      } else {
        console.warn('[context-gatherer] failed to gather context:', outcome.reason)
      }
    }
  }

  return results
}

async function gatherContextForFile(diffFile: DiffFile, repoRoot: string): Promise<ReviewFile> {
  const filePath = `${repoRoot}/${diffFile.path}`
  const context = await gatherFileContext(filePath, repoRoot)
  return { diffFile, context }
}
