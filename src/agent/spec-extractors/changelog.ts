// ---------------------------------------------------------------------------
// changelog.ts — Extract body of a `.changeset/*.md` entry OR latest section
// (`[Unreleased]` or `[x.y.z]`) from `CHANGELOG.md`. Detects bump type.
// ---------------------------------------------------------------------------

import type { ExtractedSpec } from './types.ts'
import { parseFrontmatter, safeRead, truncateBudget } from './shared.ts'

const PER_FILE_BUDGET = 500

function detectBumpType(frontmatterValue: string | undefined): 'patch' | 'minor' | 'major' | null {
  if (!frontmatterValue) return null
  const v = frontmatterValue.toLowerCase()
  if (v.includes('major')) return 'major'
  if (v.includes('minor')) return 'minor'
  if (v.includes('patch')) return 'patch'
  return null
}

function extractFirstChangelogSection(text: string): string | null {
  const lines = text.split('\n')
  let started = false
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const isHeading = /^## \[/.test(line) || /^## v?\d/.test(line)
    if (!started) {
      if (isHeading) {
        started = true
        out.push(line)
      }
      continue
    }
    if (isHeading) break
    out.push(line)
  }
  if (out.length === 0) return null
  return out.join('\n').trim()
}

export function extractChangelog(relPath: string, repoPath: string): ExtractedSpec {
  const text = safeRead(repoPath, relPath)
  if (text == null) {
    return {
      class: 'changelog',
      sourcePath: relPath,
      sections: [],
      meta: { error: 'unreadable' },
    }
  }

  if (relPath === 'CHANGELOG.md' || relPath.endsWith('/CHANGELOG.md')) {
    const section = extractFirstChangelogSection(text)
    if (!section) {
      return {
        class: 'changelog',
        sourcePath: relPath,
        sections: [],
        meta: { error: 'no version section found' },
      }
    }
    return {
      class: 'changelog',
      sourcePath: relPath,
      sections: [{ heading: 'CHANGELOG', body: truncateBudget(section, PER_FILE_BUDGET) }],
      meta: { source: 'CHANGELOG.md' },
    }
  }

  // .changeset/*.md
  const { data, body } = parseFrontmatter(text)
  // Frontmatter shape: { 'package-name': 'patch' | 'minor' | 'major' }
  let bumpType: 'patch' | 'minor' | 'major' | null = null
  for (const v of Object.values(data)) {
    bumpType = detectBumpType(v)
    if (bumpType) break
  }

  const meta: Record<string, string> = { source: 'changeset' }
  if (bumpType) meta['bumpType'] = bumpType

  const sectionBody = body.trim()
  if (!sectionBody) {
    return {
      class: 'changelog',
      sourcePath: relPath,
      sections: [],
      meta: { ...meta, error: 'empty changeset body' },
    }
  }

  return {
    class: 'changelog',
    sourcePath: relPath,
    sections: [{ heading: 'CHANGESET', body: truncateBudget(sectionBody, PER_FILE_BUDGET) }],
    meta,
  }
}
