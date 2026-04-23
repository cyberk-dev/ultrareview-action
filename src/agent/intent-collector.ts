/**
 * intent-collector.ts — One-shot orchestrator that gathers PR intent
 * (title, body, linked issues) + classified spec files in the diff and
 * formats them into a single text block prepended to the analyzer prompt.
 *
 * Graceful skip: returns an empty string when nothing useful is collected
 * (no PR meta + no specs) so the analyzer behaves identically to v0.2.0.
 */

import { fetchPRMeta, resolveCurrentPR, type PRMeta } from './pr-meta-fetcher.ts'
import { scanSpecFiles, type SpecFileEntry } from './spec-classifier.ts'
import { extractByClass, type ExtractedSpec } from './spec-extractors/index.ts'
import { formatIntentSection } from './intent-formatter.ts'
import { collectSpecsFromGraph } from './intent-from-graph.ts'
import { getChangedFiles } from './gitnexus-diff.ts'

export type CollectIntentInput = {
  baseRef: string
  headRef: string
  repoPath: string
  owner?: string
  repo?: string
  prNumber?: number
}

const DEFAULT_BUDGET = 4000

function isEnabled(): boolean {
  const env = process.env['INTENT_ENABLED']
  if (env == null) return true
  return env.toLowerCase() !== 'false' && env !== '0'
}

function isPRMetaEnabled(): boolean {
  const env = process.env['INTENT_PR_META']
  if (env == null) return true
  return env.toLowerCase() !== 'false' && env !== '0'
}

function getBudget(): number {
  const env = process.env['INTENT_BUDGET_CHARS']
  if (!env) return DEFAULT_BUDGET
  const n = parseInt(env, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET
}

/**
 * Merge spec entries from two sources, deduping by path and keeping the
 * higher-confidence entry (so diff-detected always wins over graph-derived).
 */
export function mergeSpecEntries(
  primary: SpecFileEntry[],
  secondary: SpecFileEntry[],
): SpecFileEntry[] {
  const byPath = new Map<string, SpecFileEntry>()
  for (const e of primary) byPath.set(e.path, e)
  for (const e of secondary) {
    const existing = byPath.get(e.path)
    if (!existing || existing.confidence < e.confidence) byPath.set(e.path, e)
  }
  return [...byPath.values()]
}

export async function collectIntent(input: CollectIntentInput): Promise<string> {
  if (!isEnabled()) return ''

  const { baseRef, headRef, repoPath } = input
  if (!baseRef || !headRef || !repoPath) return ''

  // PR meta (independent of diff content) runs in parallel with diff fetch.
  const metaPromise = (async (): Promise<PRMeta | null> => {
    if (!isPRMetaEnabled()) return null
    const target = input.owner && input.repo && input.prNumber
      ? { owner: input.owner, repo: input.repo, prNumber: input.prNumber }
      : await resolveCurrentPR()
    if (!target) return null
    return fetchPRMeta(target)
  })()

  // Resolve changed files once — needed by both spec scan and graph collector.
  let changedFiles: string[] = []
  try {
    changedFiles = await getChangedFiles(baseRef, headRef, repoPath)
  } catch {
    /* getChangedFiles already returns [] on error; this is defensive */
  }

  // Spec scan (diff-detected) + Graph spec collection (related, not in diff)
  // run in parallel; both tolerate failure.
  const [diffSpecsResult, graphSpecsResult, metaResult] = await Promise.allSettled([
    scanSpecFiles({ baseRef, headRef, repoPath }),
    collectSpecsFromGraph({
      baseRef,
      headRef,
      repoPath,
      prTitle: undefined,        // PR title injected later if metaPromise resolved before us
      changedFiles,
    }),
    metaPromise,
  ])

  const diffEntries = diffSpecsResult.status === 'fulfilled' ? diffSpecsResult.value : []
  const graphEntries = graphSpecsResult.status === 'fulfilled' ? graphSpecsResult.value : []
  const prMeta = metaResult.status === 'fulfilled' ? metaResult.value : null

  const merged = mergeSpecEntries(diffEntries, graphEntries)

  const extracted: ExtractedSpec[] = []
  for (const entry of merged) {
    const ex = extractByClass(entry, repoPath)
    if (ex.sections.length > 0) extracted.push(ex)
  }

  if (!prMeta && extracted.length === 0) return ''

  return formatIntentSection(prMeta, extracted, getBudget())
}
