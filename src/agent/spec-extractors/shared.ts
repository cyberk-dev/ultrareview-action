// ---------------------------------------------------------------------------
// shared.ts — Helpers shared by spec extractors: H2 section parsing, YAML-lite
// frontmatter parsing, todo checkbox counting, safe path/file utilities.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { isAbsolute, normalize, relative, resolve } from 'node:path'

export type Section = { heading: string; body: string }

// ---------------------------------------------------------------------------
// Frontmatter (YAML-lite: simple `key: value` lines, no nesting/arrays)
// ---------------------------------------------------------------------------

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseFrontmatter(markdown: string): {
  data: Record<string, string>
  body: string
} {
  const m = markdown.match(FRONTMATTER_REGEX)
  if (!m) return { data: {}, body: markdown }
  const data: Record<string, string> = {}
  const block = m[1] ?? ''
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    // Strip optional surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) data[key] = value
  }
  return { data, body: markdown.slice(m[0].length) }
}

// ---------------------------------------------------------------------------
// H2 section parser — split body on `## ` headings.
// ---------------------------------------------------------------------------

export function parseH2Sections(markdown: string): Section[] {
  const lines = markdown.split('\n')
  const out: Section[] = []
  let current: Section | null = null
  let inFence = false

  for (const line of lines) {
    // Track fenced code blocks so we don't capture their `## ` lines as headings.
    if (line.startsWith('```')) {
      inFence = !inFence
      if (current) current.body += line + '\n'
      continue
    }
    if (!inFence && line.startsWith('## ')) {
      if (current) out.push({ heading: current.heading, body: current.body.trimEnd() })
      current = { heading: line.slice(3).trim(), body: '' }
      continue
    }
    if (current) current.body += line + '\n'
  }
  if (current) out.push({ heading: current.heading, body: current.body.trimEnd() })
  return out
}

// ---------------------------------------------------------------------------
// Checkbox counter — only counts checkboxes at line start (avoid code blocks).
// ---------------------------------------------------------------------------

export function countCheckboxes(markdown: string): { total: number; done: number } {
  let total = 0
  let done = 0
  let inFence = false
  for (const rawLine of markdown.split('\n')) {
    if (rawLine.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const line = rawLine.trimStart()
    const m = line.match(/^- \[( |x|X)\]\s/)
    if (!m) continue
    total += 1
    if (m[1] === 'x' || m[1] === 'X') done += 1
  }
  return { total, done }
}

// ---------------------------------------------------------------------------
// Path safety — reject traversal outside repoPath.
// ---------------------------------------------------------------------------

export function isPathSafe(repoPath: string, filePath: string): boolean {
  const absRepo = resolve(repoPath)
  const absFile = isAbsolute(filePath) ? resolve(filePath) : resolve(repoPath, filePath)
  const rel = relative(absRepo, absFile)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

export function safeRead(repoPath: string, filePath: string): string | null {
  if (!isPathSafe(repoPath, filePath)) return null
  try {
    return readFileSync(isAbsolute(filePath) ? filePath : resolve(repoPath, filePath), 'utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

export function truncateBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, Math.max(0, maxChars - 14)) + '\n... [truncated]'
}

export function truncateSections(sections: Section[], budget: number): Section[] {
  const out: Section[] = []
  let used = 0
  for (const s of sections) {
    const headingLen = s.heading.length + 4 // `### \n`
    const remaining = budget - used - headingLen
    if (remaining <= 0) break
    const body = s.body.length > remaining ? truncateBudget(s.body, remaining) : s.body
    out.push({ heading: s.heading, body })
    used += headingLen + body.length
  }
  return out
}
