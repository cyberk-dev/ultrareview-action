// ---------------------------------------------------------------------------
// openspec.ts — Extract WHY/HOW/TODO/CAPABILITIES from an OpenSpec change folder.
// Reads sibling `proposal.md`, `design.md`, `tasks.md`, `specs/*.md`.
// ---------------------------------------------------------------------------

import { readdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import type { ExtractedSpec } from './types.ts'
import { countCheckboxes, parseH2Sections, safeRead, truncateBudget } from './shared.ts'

const PER_FILE_BUDGET = 1000

function findChangeRoot(repoPath: string, relPath: string): string {
  // OpenSpec slug folder is `openspec/changes/<slug>`. Walk up from file dir
  // until parent is `changes`.
  let dir = dirname(relPath)
  while (dir && basename(dirname(dir)) !== 'changes' && dir !== '.') {
    dir = dirname(dir)
  }
  return dir || dirname(relPath)
}

function safeReadDir(p: string): string[] {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

function pickH2(body: string, names: string[]): string {
  const sections = parseH2Sections(body)
  const wanted = names.map((n) => n.toLowerCase())
  for (const s of sections) {
    if (wanted.includes(s.heading.toLowerCase())) return s.body.trim()
  }
  // Fallback: first 800 chars of full body
  return body.trim().slice(0, 800)
}

export function extractOpenSpec(relPath: string, repoPath: string): ExtractedSpec {
  const changeRoot = findChangeRoot(repoPath, relPath)
  const slug = basename(changeRoot)

  const sections: ExtractedSpec['sections'] = []
  const meta: Record<string, string> = { changeSlug: slug }

  const proposal = safeRead(repoPath, join(changeRoot, 'proposal.md'))
  if (proposal) {
    const why = pickH2(proposal, ['Why', 'Motivation', 'Problem', 'Goal'])
    if (why) sections.push({ heading: 'WHY', body: truncateBudget(why, PER_FILE_BUDGET) })
  }

  const design = safeRead(repoPath, join(changeRoot, 'design.md'))
  if (design) {
    const how = pickH2(design, ['Design', 'Approach', 'Architecture', 'Solution', 'Overview'])
    if (how) sections.push({ heading: 'HOW', body: truncateBudget(how, PER_FILE_BUDGET) })
  }

  const tasks = safeRead(repoPath, join(changeRoot, 'tasks.md'))
  if (tasks) {
    const counts = countCheckboxes(tasks)
    meta.todoTotal = String(counts.total)
    meta.todoDone = String(counts.done)
    const summary = `${counts.done}/${counts.total} done\n${truncateBudget(tasks.trim(), PER_FILE_BUDGET - 40)}`
    sections.push({ heading: 'TODO', body: summary })
  }

  // CAPABILITIES — H1s from openspec/specs/*.md siblings
  const specsDir = join(repoPath, changeRoot, 'specs')
  const specFiles = safeReadDir(specsDir).filter((f) => f.endsWith('.md'))
  if (specFiles.length > 0) {
    const caps: string[] = []
    for (const f of specFiles) {
      const text = safeRead(repoPath, join(changeRoot, 'specs', f))
      if (!text) continue
      for (const line of text.split('\n')) {
        if (line.startsWith('# ')) caps.push(`- ${line.slice(2).trim()} (${f})`)
      }
    }
    if (caps.length > 0) {
      sections.push({
        heading: 'CAPABILITIES',
        body: truncateBudget(caps.join('\n'), PER_FILE_BUDGET),
      })
    }
  }

  if (sections.length === 0) {
    return {
      class: 'openspec',
      sourcePath: relPath,
      sections: [],
      meta: { ...meta, error: 'no readable sibling files (proposal/design/tasks)' },
    }
  }

  return { class: 'openspec', sourcePath: relPath, sections, meta }
}
