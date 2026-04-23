// ---------------------------------------------------------------------------
// ck-plan.ts — Extract OVERVIEW/PHASES/SUCCESS CRITERIA/TODO from a CK-Plan.
// Supports nested form (plans/<slug>/{plan.md, phase-*.md}) and flat form
// (plans/<name>.md as a single file).
// ---------------------------------------------------------------------------

import { readdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import type { ExtractedSpec } from './types.ts'
import {
  countCheckboxes,
  parseFrontmatter,
  parseH2Sections,
  safeRead,
  truncateBudget,
} from './shared.ts'

const PER_FILE_BUDGET = 1500

function safeReadDir(p: string): string[] {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

function summarizeOverview(planMd: string): string {
  const { data } = parseFrontmatter(planMd)
  const sections = parseH2Sections(planMd)
  const overview =
    sections.find((s) => /^(overview|context|summary)$/i.test(s.heading))?.body?.trim() ?? ''
  const lines: string[] = []
  if (data['title']) lines.push(`Title: ${data['title']}`)
  if (data['status']) lines.push(`Status: ${data['status']}`)
  if (data['mode']) lines.push(`Mode: ${data['mode']}`)
  if (overview) lines.push('', overview)
  return lines.join('\n').trim()
}

function summarizePhase(phaseMd: string, fileName: string): string {
  const sections = parseH2Sections(phaseMd)
  const overview = sections.find((s) => /^overview$/i.test(s.heading))?.body?.trim() ?? ''
  const todo = sections.find((s) => /^todo( list)?$/i.test(s.heading))?.body?.trim() ?? ''
  const success = sections.find((s) => /^success criteria$/i.test(s.heading))?.body?.trim() ?? ''

  const counts = todo ? countCheckboxes(todo) : { done: 0, total: 0 }
  const lines: string[] = [`Phase: ${fileName}`]
  if (overview) lines.push(overview.split('\n').slice(0, 6).join('\n'))
  if (counts.total > 0) lines.push(`Todo: ${counts.done}/${counts.total}`)
  if (success) lines.push(`Success: ${success.split('\n').slice(0, 4).join(' / ')}`)
  return lines.join('\n')
}

export function extractCKPlan(relPath: string, repoPath: string): ExtractedSpec {
  const planDir = dirname(relPath)
  const planFileName = basename(relPath)
  const isFlat = planDir === 'plans' || planDir === '.'

  const meta: Record<string, string> = {}
  const sections: ExtractedSpec['sections'] = []

  if (isFlat) {
    // Flat: single plans/<name>.md
    const text = safeRead(repoPath, relPath)
    if (!text) {
      return { class: 'ck-plan', sourcePath: relPath, sections: [], meta: { error: 'unreadable' } }
    }
    const overview = summarizeOverview(text)
    if (overview) sections.push({ heading: 'OVERVIEW', body: truncateBudget(overview, PER_FILE_BUDGET / 2) })

    const success = parseH2Sections(text).find((s) =>
      /^success criteria$/i.test(s.heading),
    )?.body?.trim()
    if (success) {
      sections.push({ heading: 'SUCCESS CRITERIA', body: truncateBudget(success, 600) })
    }

    const counts = countCheckboxes(text)
    if (counts.total > 0) {
      meta['todoDone'] = String(counts.done)
      meta['todoTotal'] = String(counts.total)
      sections.push({
        heading: 'TODO',
        body: `${counts.done}/${counts.total} checkboxes done`,
      })
    }
    meta['form'] = 'flat'
    return { class: 'ck-plan', sourcePath: relPath, sections, meta }
  }

  // Nested: plans/<slug>/{plan.md, phase-*.md}
  const planMd = safeRead(repoPath, join(planDir, 'plan.md'))
  if (planMd) {
    const overview = summarizeOverview(planMd)
    if (overview) sections.push({ heading: 'OVERVIEW', body: truncateBudget(overview, 700) })
    const fm = parseFrontmatter(planMd).data
    if (fm['status']) meta['planStatus'] = fm['status']
  }

  const dirEntries = safeReadDir(join(repoPath, planDir))
  const phaseFiles = dirEntries
    .filter((f) => /^phase-.*\.md$/.test(f))
    .sort()

  meta['phaseCount'] = String(phaseFiles.length)
  let phasesCompleted = 0
  const phaseSummaries: string[] = []
  for (const f of phaseFiles) {
    const text = safeRead(repoPath, join(planDir, f))
    if (!text) continue
    const summary = summarizePhase(text, f)
    phaseSummaries.push(summary)
    const status = parseH2Sections(text).find((s) => /^overview$/i.test(s.heading))?.body ?? ''
    if (/status:\s*(complete|completed|done)/i.test(status)) phasesCompleted += 1
  }
  meta['phasesCompleted'] = String(phasesCompleted)

  if (phaseSummaries.length > 0) {
    const joined = phaseSummaries.join('\n\n')
    sections.push({ heading: 'PHASES', body: truncateBudget(joined, 800) })
  }

  if (sections.length === 0) {
    return { class: 'ck-plan', sourcePath: relPath, sections: [], meta: { ...meta, error: 'no readable plan/phases' } }
  }

  meta['form'] = 'nested'
  return { class: 'ck-plan', sourcePath: relPath, sections, meta }
}
