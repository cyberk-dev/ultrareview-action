/**
 * spec-classifier.ts — Scan the PR diff for `.md` spec files and classify
 * each into OpenSpec / CK-Plan / Generic / Changelog / Unknown with a
 * confidence score (0-1). Sibling-file probes drive confidence (e.g. an
 * OpenSpec change folder with both `proposal.md` + `tasks.md` scores 1.0).
 *
 * Output feeds the per-class extractors (`spec-extractors/*`) and the intent
 * formatter (`intent-formatter.ts`). All env knobs (`INTENT_SCAN_PATHS`,
 * `INTENT_CLASSIFIER`, `INTENT_CLASSIFIER_MIN_CONFIDENCE`) are read here.
 *
 * Memoized per `(repoPath, base..head, mode)` for the lifetime of the process.
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, join, basename, normalize, sep, posix } from 'node:path'
import { readdirSync } from 'node:fs'
import { getChangedFiles } from './gitnexus-diff.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpecClass = 'openspec' | 'ck-plan' | 'generic' | 'changelog' | 'unknown'

export type SpecFileEntry = {
  path: string        // repo-root-relative, posix-style
  class: SpecClass
  confidence: number  // 0-1
  hint: string
}

export type ScanInput = {
  baseRef: string
  headRef: string
  repoPath: string
}

// ---------------------------------------------------------------------------
// Defaults & env
// ---------------------------------------------------------------------------

const DEFAULT_SCAN_PATHS = [
  'plans/**/*.md',
  'openspec/**/*.md',
  'docs/**/*.md',
  'specs/**/*.md',
  'rfc/**/*.md',
  'adr/**/*.md',
  '.changeset/*.md',
  'CHANGELOG.md',
]

const DEFAULT_MIN_CONFIDENCE = 0.6

function getScanPaths(): string[] {
  const env = process.env['INTENT_SCAN_PATHS']
  if (!env) return DEFAULT_SCAN_PATHS
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

function getMinConfidence(): number {
  const env = process.env['INTENT_CLASSIFIER_MIN_CONFIDENCE']
  if (!env) return DEFAULT_MIN_CONFIDENCE
  const n = parseFloat(env)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_MIN_CONFIDENCE
}

function getMode(): 'auto' | 'openspec' | 'plan' | 'generic' | 'disabled' {
  const env = (process.env['INTENT_CLASSIFIER'] ?? 'auto').toLowerCase()
  if (env === 'openspec' || env === 'plan' || env === 'generic' || env === 'disabled') return env
  return 'auto'
}

// ---------------------------------------------------------------------------
// Glob matching — KISS: convert simple `**` / `*` patterns to RegExp.
// Patterns are POSIX-style (forward slashes).
// ---------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  // Escape regex special chars except *, ?, /
  let pattern = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]!
    if (c === '*') {
      // ** => match any chars including /
      // *  => match any chars except /
      if (glob[i + 1] === '*') {
        // consume optional trailing /
        if (glob[i + 2] === '/') {
          pattern += '(?:.*/)?'
          i += 3
        } else {
          pattern += '.*'
          i += 2
        }
      } else {
        pattern += '[^/]*'
        i += 1
      }
    } else if (c === '?') {
      pattern += '[^/]'
      i += 1
    } else if ('.+^$|(){}[]\\'.includes(c)) {
      pattern += '\\' + c
      i += 1
    } else {
      pattern += c
      i += 1
    }
  }
  return new RegExp('^' + pattern + '$')
}

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep)
}

function matchesAnyGlob(path: string, globs: string[]): boolean {
  const posixPath = toPosix(path)
  for (const g of globs) {
    if (globToRegExp(g).test(posixPath)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Per-file classifier
// ---------------------------------------------------------------------------

function safeExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

function safeReadDir(p: string): string[] {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

function safeIsFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Classify a single file path. `repoPath` is repo root for sibling lookups. */
export function classifyFile(path: string, repoPath: string): SpecFileEntry {
  const posixPath = toPosix(path)
  const absPath = join(repoPath, path)
  const dir = dirname(absPath)
  const fileName = basename(absPath)

  // --- Changelog ---
  if (posixPath === 'CHANGELOG.md' || /^\.changeset\/.+\.md$/.test(posixPath)) {
    if (posixPath === '.changeset/README.md' || posixPath === '.changeset/config.json') {
      return { path: posixPath, class: 'unknown', confidence: 0.3, hint: 'changeset config (skipped)' }
    }
    return {
      path: posixPath,
      class: 'changelog',
      confidence: 1.0,
      hint: posixPath === 'CHANGELOG.md' ? 'CHANGELOG.md' : 'changeset entry',
    }
  }

  // --- OpenSpec: openspec/changes/<slug>/*.md with sibling proposal/tasks ---
  if (/^openspec\/changes\/[^/]+\//.test(posixPath)) {
    const hasProposal = safeExists(join(dir, 'proposal.md')) || safeExists(join(dir, '..', 'proposal.md'))
    const hasTasks = safeExists(join(dir, 'tasks.md')) || safeExists(join(dir, '..', 'tasks.md'))
    if (hasProposal && hasTasks) {
      return { path: posixPath, class: 'openspec', confidence: 1.0, hint: 'openspec: proposal.md + tasks.md siblings' }
    }
    if (hasProposal || hasTasks) {
      return { path: posixPath, class: 'openspec', confidence: 0.8, hint: 'openspec: one of proposal/tasks present' }
    }
    return { path: posixPath, class: 'openspec', confidence: 0.6, hint: 'openspec path, no siblings detected' }
  }

  // --- CK-Plan: plans/<slug>/ nested OR plans/<name>.md flat ---
  if (/^plans\//.test(posixPath)) {
    // Nested form: plans/<slug>/{plan.md, phase-*.md}
    if (/^plans\/[^/]+\/[^/]+\.md$/.test(posixPath)) {
      const hasPlan = safeExists(join(dir, 'plan.md'))
      const phaseFiles = safeReadDir(dir).filter((f) => /^phase-.*\.md$/.test(f))
      if (hasPlan && phaseFiles.length > 0) {
        return { path: posixPath, class: 'ck-plan', confidence: 1.0, hint: `ck-plan nested: plan.md + ${phaseFiles.length} phase(s)` }
      }
      if (hasPlan) {
        return { path: posixPath, class: 'ck-plan', confidence: 0.8, hint: 'ck-plan nested: plan.md only' }
      }
    }
    // Flat form: plans/<name>.md
    if (/^plans\/[^/]+\.md$/.test(posixPath)) {
      return { path: posixPath, class: 'ck-plan', confidence: 0.6, hint: 'ck-plan flat: single-file plan' }
    }
    // Fallback inside plans/
    return { path: posixPath, class: 'ck-plan', confidence: 0.5, hint: 'plans/ subtree, ambiguous' }
  }

  // --- Generic: docs/, specs/, rfc/, adr/ ---
  if (/^(docs|specs|rfc|adr)\/.+\.md$/.test(posixPath)) {
    return { path: posixPath, class: 'generic', confidence: 0.7, hint: 'generic spec doc' }
  }

  // --- Unknown ---
  return { path: posixPath, class: 'unknown', confidence: 0.3, hint: 'unrecognized .md path' }
}

// ---------------------------------------------------------------------------
// Memoization keyed by base..head
// ---------------------------------------------------------------------------

const scanCache = new Map<string, SpecFileEntry[]>()

export function _clearSpecScanCache(): void {
  scanCache.clear()
}

// ---------------------------------------------------------------------------
// Entry: scanSpecFiles
// ---------------------------------------------------------------------------

export async function scanSpecFiles(input: ScanInput): Promise<SpecFileEntry[]> {
  const mode = getMode()
  if (mode === 'disabled') return []

  const { baseRef, headRef, repoPath } = input
  if (!baseRef || !headRef || !repoPath) return []

  const key = `${repoPath}::${baseRef}..${headRef}::${mode}`
  const cached = scanCache.get(key)
  if (cached) return cached

  const changed = await getChangedFiles(baseRef, headRef, repoPath)
  if (changed.length === 0) {
    scanCache.set(key, [])
    return []
  }

  const scanGlobs = getScanPaths()
  const minConf = getMinConfidence()

  const onlyMd = changed.filter((p) => p.endsWith('.md'))
  const inScope = onlyMd.filter((p) => matchesAnyGlob(p, scanGlobs))

  const entries: SpecFileEntry[] = []
  for (const path of inScope) {
    let entry = classifyFile(path, repoPath)
    // Mode override: force class for matching paths (skip unknown).
    if (mode !== 'auto' && entry.class !== 'unknown') {
      const mapped: SpecClass = mode === 'plan' ? 'ck-plan' : (mode as SpecClass)
      if (entry.class !== mapped) {
        entry = { ...entry, class: mapped, hint: `${entry.hint} (forced via INTENT_CLASSIFIER=${mode})` }
      }
    }
    // Below threshold → downgrade
    if (entry.confidence < minConf && entry.class !== 'unknown') {
      entry = { ...entry, class: 'unknown', hint: `${entry.hint} (below confidence ${minConf})` }
    }
    // Existence sanity: file must exist on disk for downstream extractors
    if (!safeIsFile(join(repoPath, path))) {
      entry = { ...entry, hint: `${entry.hint} (missing on disk)` }
    }
    entries.push(entry)
  }

  scanCache.set(key, entries)
  return entries
}
