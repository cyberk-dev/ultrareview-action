// ---------------------------------------------------------------------------
// bug-classifier.ts — Zero-shot classify RawBugs into 26-type taxonomy.
// Uses a fast model (AI_CLASSIFY_MODEL) with batch classification.
// ---------------------------------------------------------------------------

import { chat } from '../services/ai-client.ts'
import { extractJsonArray } from './json-extractor.ts'
import type { RawBug } from './deep-analyzer.ts'

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type BugDomain = 'security' | 'logic' | 'data' | 'performance' | 'api' | 'style'

export const BUG_TAXONOMY: Record<BugDomain, string[]> = {
  security: ['injection', 'auth-bypass', 'secret-leak', 'path-traversal', 'insecure-crypto'],
  logic: ['null-reference', 'race-condition', 'off-by-one', 'wrong-conditional', 'infinite-loop'],
  data: ['missing-validation', 'type-mismatch', 'unhandled-error', 'data-loss', 'encoding-issue'],
  performance: ['n-plus-one', 'memory-leak', 'blocking-io', 'unnecessary-recompute'],
  api: ['breaking-change', 'missing-error-handling', 'contract-violation', 'deprecated-usage'],
  style: ['naming-convention', 'dead-code', 'code-duplication', 'magic-numbers', 'missing-types'],
}

/** Map legacy category to closest domain as fallback */
const CATEGORY_TO_DOMAIN: Record<string, BugDomain> = {
  security: 'security',
  logic: 'logic',
  performance: 'performance',
  style: 'style',
  'edge-case': 'data',
}

const CLASSIFY_MODEL = process.env.AI_CLASSIFY_MODEL ?? 'gpt-5.4-mini'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClassifiedBug = RawBug & {
  domain: BugDomain
  bugType: string
  classificationConfidence: number
}

type ClassifyResult = {
  index: number
  domain: BugDomain
  bugType: string
  confidence: number
}

// ---------------------------------------------------------------------------
// Build taxonomy listing for prompt
// ---------------------------------------------------------------------------

function buildTaxonomyText(): string {
  return Object.entries(BUG_TAXONOMY)
    .map(([domain, types]) => `  ${domain}: ${types.join(', ')}`)
    .join('\n')
}

const CLASSIFY_SYSTEM = `You are a bug classification system. Classify bugs into the provided taxonomy.
Output JSON array only. No prose, no markdown.`

// ---------------------------------------------------------------------------
// Batch classify all bugs in one AI call
// ---------------------------------------------------------------------------

export async function classifyAllBugs(bugs: RawBug[]): Promise<ClassifiedBug[]> {
  if (bugs.length === 0) return []

  const taxonomyText = buildTaxonomyText()
  const bugsPayload = bugs.map((b, i) => ({ index: i, title: b.title, description: b.description }))

  const prompt = `Taxonomy:\n${taxonomyText}\n\nClassify each bug. Output JSON array: [{ index, domain, bugType, confidence }]\nwhere confidence is 0-1.\n\nBugs:\n${JSON.stringify(bugsPayload, null, 2)}`

  const prevModel = process.env.AI_MODEL
  process.env.AI_MODEL = CLASSIFY_MODEL

  let results: ClassifyResult[] = []

  try {
    const response = await chat(
      [{ role: 'user', content: prompt }],
      { system: CLASSIFY_SYSTEM, maxTokens: 2048 },
    )
    results = extractJsonArray<ClassifyResult>(response)
  } catch (err) {
    console.warn('[bug-classifier] batch classify failed:', err instanceof Error ? err.message : String(err))
  } finally {
    if (prevModel === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = prevModel
  }

  // Map results back to bugs
  const resultMap = new Map<number, ClassifyResult>()
  for (const r of results) {
    if (typeof r.index === 'number') resultMap.set(r.index, r)
  }

  return bugs.map((bug, i) => {
    const r = resultMap.get(i)
    if (r && r.domain && r.bugType) {
      return { ...bug, domain: r.domain, bugType: r.bugType, classificationConfidence: r.confidence ?? 0.5 }
    }
    // Fallback: map legacy category to domain
    const domain = CATEGORY_TO_DOMAIN[bug.category] ?? 'logic'
    return { ...bug, domain, bugType: bug.category, classificationConfidence: 0.3 }
  })
}

// ---------------------------------------------------------------------------
// Single bug classify (delegates to batch for consistency)
// ---------------------------------------------------------------------------

export async function classifyBug(bug: RawBug): Promise<ClassifiedBug> {
  const [result] = await classifyAllBugs([bug])
  return result!
}
