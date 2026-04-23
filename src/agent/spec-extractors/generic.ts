// ---------------------------------------------------------------------------
// generic.ts — Extract whitelisted H2 sections from a generic spec doc
// (`docs/`, `specs/`, `rfc/`, `adr/`). Whitelist tunable via env
// `INTENT_GENERIC_HEADINGS=<comma-separated>` (Validation Session 1).
// ---------------------------------------------------------------------------

import type { ExtractedSpec } from './types.ts'
import { parseH2Sections, safeRead, truncateBudget, truncateSections } from './shared.ts'

const PER_FILE_BUDGET = 800

const DEFAULT_HEADINGS = [
  'Overview',
  'Summary',
  'Goal',
  'Goals',
  'Problem',
  'Requirements',
  'Functional Requirements',
  'Success Criteria',
  'Acceptance Criteria',
  'Todo',
  'Tasks',
  'Non-Goals',
]

function getWhitelist(): string[] {
  const env = process.env['INTENT_GENERIC_HEADINGS']
  if (!env) return DEFAULT_HEADINGS
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

export function extractGeneric(relPath: string, repoPath: string): ExtractedSpec {
  const text = safeRead(repoPath, relPath)
  if (text == null) {
    return {
      class: 'generic',
      sourcePath: relPath,
      sections: [],
      meta: { error: 'unreadable' },
    }
  }

  const allSections = parseH2Sections(text)
  const whitelist = getWhitelist().map((h) => h.toLowerCase())
  const matched = allSections.filter((s) => whitelist.includes(s.heading.toLowerCase()))
  const trimmed = truncateSections(
    matched.map((s) => ({ heading: s.heading.toUpperCase(), body: s.body.trim() })),
    PER_FILE_BUDGET,
  )

  return {
    class: 'generic',
    sourcePath: relPath,
    sections: trimmed,
    meta: {
      h2Count: String(allSections.length),
      matchedCount: String(matched.length),
    },
  }
}
