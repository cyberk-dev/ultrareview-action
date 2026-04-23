// ---------------------------------------------------------------------------
// index.ts — Router: dispatch SpecFileEntry → appropriate extractor.
// Wraps extractors in try/catch so a single broken file never aborts the run.
// ---------------------------------------------------------------------------

import type { SpecFileEntry } from '../spec-classifier.ts'
import type { ExtractedSpec } from './types.ts'
import { extractOpenSpec } from './openspec.ts'
import { extractCKPlan } from './ck-plan.ts'
import { extractGeneric } from './generic.ts'
import { extractChangelog } from './changelog.ts'

export type { ExtractedSpec } from './types.ts'

export function extractByClass(entry: SpecFileEntry, repoPath: string): ExtractedSpec {
  try {
    switch (entry.class) {
      case 'openspec':
        return extractOpenSpec(entry.path, repoPath)
      case 'ck-plan':
        return extractCKPlan(entry.path, repoPath)
      case 'changelog':
        return extractChangelog(entry.path, repoPath)
      case 'generic':
      case 'unknown':
        return extractGeneric(entry.path, repoPath)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      class: entry.class,
      sourcePath: entry.path,
      sections: [],
      meta: { error: `extractor threw: ${msg}` },
    }
  }
}
