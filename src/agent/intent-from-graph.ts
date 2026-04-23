/**
 * intent-from-graph.ts — Augments INTENT with spec/doc paths surfaced by
 * GitNexus's keyword query over the indexed `.md` corpus (Section + File
 * nodes). Confidence downgraded so diff-detected specs always win on collision.
 *
 * NOTE (post Phase 0): the original "graph-walk from code symbol" hypothesis
 * was disproved — `.md` files have no edges to code in the GitNexus graph.
 * This module instead issues a single keyword `query()` call built from the
 * PR title, changed file paths, and changed symbol names, then harvests the
 * `.md` paths that come back in `definitions[]`.
 *
 * Graceful skip on every failure path; never throws.
 */

import { basename, dirname, sep } from 'node:path'
import { query as gnQuery, type QueryDefinition } from './gitnexus-typed-wrappers.ts'
import { resolveRepoName, isEnabled as isGitNexusEnabled } from './gitnexus-client.ts'
import { classifyFile, type SpecFileEntry } from './spec-classifier.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollectFromGraphInput = {
  baseRef: string
  headRef: string
  repoPath: string
  prTitle?: string
  changedFiles?: string[]
  changedSymbols?: string[]
}

// ---------------------------------------------------------------------------
// Defaults & env
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SPECS = 2
const DEFAULT_EXCLUDED = ['README.md', 'LICENSE', 'CONTRIBUTING.md']
const DEFAULT_SCAN_GLOBS = [
  'plans/**/*.md',
  'openspec/**/*.md',
  'docs/**/*.md',
  'specs/**/*.md',
  'rfc/**/*.md',
  'adr/**/*.md',
]
const QUERY_LIMIT = 5

function isEnabled(): boolean {
  if (!isGitNexusEnabled()) return false
  const env = process.env['INTENT_GRAPH_BRIDGE']
  if (env == null) return true
  return env.toLowerCase() !== 'false' && env !== '0'
}

function getMaxSpecs(): number {
  const env = process.env['INTENT_GRAPH_MAX_SPECS']
  if (!env) return DEFAULT_MAX_SPECS
  const n = parseInt(env, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SPECS
}

function getExcluded(): Set<string> {
  const env = process.env['INTENT_GRAPH_EXCLUDED']
  if (!env) return new Set(DEFAULT_EXCLUDED)
  return new Set(env.split(',').map((s) => s.trim()).filter(Boolean))
}

function getScanGlobs(): string[] {
  const env = process.env['INTENT_SCAN_PATHS']
  if (!env) return DEFAULT_SCAN_GLOBS
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Query string builder — heuristic combining PR title + path slugs + symbols.
// Goal: maximize chance of keyword overlap with plan/doc filenames or H2s.
// ---------------------------------------------------------------------------

const SKIP_PATH_SEGMENTS = new Set([
  'src', 'app', 'apps', 'packages', 'lib', 'modules', 'features',
  'shared', 'ui', 'model', 'utils', 'index', 'types', 'native', 'web',
  'server', 'api', 'public', 'tests', '__tests__', 'node_modules', 'dist', 'build',
])

function extractFeatureSlugs(filePaths: string[]): string[] {
  const slugs = new Set<string>()
  for (const p of filePaths) {
    const segments = p.split(/[/\\]/).filter(Boolean)
    for (const seg of segments) {
      const stripped = seg.replace(/\.[a-z0-9]+$/i, '')
      if (!stripped || SKIP_PATH_SEGMENTS.has(stripped.toLowerCase())) continue
      if (stripped.length < 3) continue
      slugs.add(stripped.replace(/[._]/g, '-'))
    }
  }
  return [...slugs].slice(0, 8)
}

export function deriveQueryString(
  prTitle: string | undefined,
  changedFiles: string[],
  changedSymbols: string[],
): string {
  const parts: string[] = []
  if (prTitle) parts.push(prTitle.replace(/[`*_~]/g, ' ').trim())
  parts.push(...extractFeatureSlugs(changedFiles))
  parts.push(...changedSymbols.slice(0, 5).map((s) => s.replace(/[^a-zA-Z0-9]/g, ' ')))
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

// ---------------------------------------------------------------------------
// Glob matching — minimal subset, mirrors spec-classifier helper.
// ---------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  let pattern = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { pattern += '(?:.*/)?'; i += 3 } else { pattern += '.*'; i += 2 }
      } else { pattern += '[^/]*'; i += 1 }
    } else if (c === '?') { pattern += '[^/]'; i += 1 }
    else if ('.+^$|(){}[]\\'.includes(c)) { pattern += '\\' + c; i += 1 }
    else { pattern += c; i += 1 }
  }
  return new RegExp('^' + pattern + '$')
}

function matchesAnyGlob(path: string, globs: string[]): boolean {
  const posix = path.split(sep).join('/')
  return globs.some((g) => globToRegExp(g).test(posix))
}

// ---------------------------------------------------------------------------
// Harvest .md paths from QueryResult.definitions
// ---------------------------------------------------------------------------

function harvestMdPaths(definitions: QueryDefinition[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const def of definitions) {
    const file = def.file
    if (!file || !file.endsWith('.md')) continue
    if (seen.has(file)) continue
    seen.add(file)
    out.push(file)
  }
  return out
}

// ---------------------------------------------------------------------------
// Entry: collectSpecsFromGraph
// ---------------------------------------------------------------------------

export async function collectSpecsFromGraph(
  input: CollectFromGraphInput,
): Promise<SpecFileEntry[]> {
  if (!isEnabled()) return []

  const { repoPath, prTitle, changedFiles = [], changedSymbols = [] } = input
  if (!repoPath) return []
  if (changedFiles.length === 0 && !prTitle) return []

  const repoName = await resolveRepoName(repoPath)
  if (!repoName) return []

  const queryString = deriveQueryString(prTitle, changedFiles, changedSymbols)
  if (!queryString) return []

  let result
  try {
    result = await gnQuery(repoName, queryString, undefined, QUERY_LIMIT)
  } catch (err) {
    console.warn('[intent-from-graph] query failed:', err instanceof Error ? err.message : String(err))
    return []
  }

  const mdPaths = harvestMdPaths(result.definitions)
  if (mdPaths.length === 0) return []

  const scanGlobs = getScanGlobs()
  const excluded = getExcluded()
  const changedSet = new Set(changedFiles.map((p) => p.split(sep).join('/')))
  const maxSpecs = getMaxSpecs()

  const entries: SpecFileEntry[] = []
  for (const path of mdPaths) {
    if (entries.length >= maxSpecs) break
    if (excluded.has(basename(path))) continue
    if (changedSet.has(path)) continue
    if (!matchesAnyGlob(path, scanGlobs)) continue
    const classified = classifyFile(path, repoPath)
    entries.push({
      ...classified,
      confidence: 0.5,
      hint: `via GitNexus query: "${queryString.slice(0, 60)}${queryString.length > 60 ? '…' : ''}"`,
    })
  }

  return entries
}
