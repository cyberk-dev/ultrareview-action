// ---------------------------------------------------------------------------
// intent-formatter.ts — Pure assembly of the `=== PR INTENT ===` text block
// from PRMeta + ExtractedSpec[]. Handles truncation precedence and escapes
// user-supplied content to prevent prompt-injection via crafted markdown.
// ---------------------------------------------------------------------------

import type { PRMeta } from './pr-meta-fetcher.ts'
import type { ExtractedSpec } from './spec-extractors/index.ts'

const PR_BODY_CAP = 1000
const TITLE_LINE_PREFIX = 'Title: '

const NOTES_PREAMBLE = [
  '===',
  'SPEC shows declared intent (from spec files).',
  'IMPACT GRAPH shows live code (from AST analysis).',
  'If they disagree, flag as POTENTIAL DRIFT — do NOT auto-trust either.',
  '',
  'Acceptable reasons for drift:',
  '  - Spec outdated',
  '  - Spec wrong',
  '  - Code wrong',
  '  - Spec not yet implemented (phase in progress)',
  '',
  'Report as bug w/ type=DRIFT, include both sides in evidence.',
  '===',
].join('\n')

// ---------------------------------------------------------------------------
// Sanitization — strip non-printable + escape code fences/backticks so spec
// or PR-body content can't break out of the analyzer prompt.
// ---------------------------------------------------------------------------

function sanitize(input: string): string {
  if (!input) return ''
  // Remove ASCII control chars except newline (0x0A) and tab (0x09).
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (code === 0x0A || code === 0x09) {
      out += input[i]
    } else if (code < 0x20 || code === 0x7F) {
      // drop
    } else {
      out += input[i]
    }
  }
  // Neutralize fence markers and backtick runs to prevent prompt-injection.
  return out.replace(/```/g, "''' ").replace(/`/g, "'")
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

// ---------------------------------------------------------------------------
// Block formatters
// ---------------------------------------------------------------------------

export function formatPRMetaBlock(meta: PRMeta | null): string {
  if (!meta) return ''
  const lines: string[] = []
  if (meta.title) lines.push(`${TITLE_LINE_PREFIX}${sanitize(meta.title)}`)
  if (meta.author) lines.push(`Author: @${sanitize(meta.author)}`)
  if (meta.labels.length > 0) lines.push(`Labels: ${meta.labels.map(sanitize).join(', ')}`)
  if (meta.body) {
    const body = normalizeWhitespace(sanitize(meta.body))
    const capped = body.length > PR_BODY_CAP ? body.slice(0, PR_BODY_CAP) + '\n... [truncated]' : body
    lines.push('', 'Body:', capped)
  }
  if (meta.linkedIssues.length > 0) {
    for (const issue of meta.linkedIssues) {
      const head = `Linked issue #${issue.number}: "${sanitize(issue.title)}"`
      const body = normalizeWhitespace(sanitize(issue.body)).slice(0, 400)
      lines.push('', head)
      if (body) lines.push(body)
    }
  }
  return lines.join('\n')
}

function formatSpecBlock(extracted: ExtractedSpec): string {
  const heading = blockHeadingFor(extracted)
  const parts = [heading]
  for (const sec of extracted.sections) {
    parts.push(`${sec.heading}:`)
    parts.push(sanitize(sec.body))
    parts.push('')
  }
  return parts.join('\n').trimEnd()
}

function blockHeadingFor(s: ExtractedSpec): string {
  switch (s.class) {
    case 'openspec':  return `=== OpenSpec: ${labelFromPath(s.sourcePath)} ===`
    case 'ck-plan':   return `=== Plan: ${labelFromPath(s.sourcePath)} ===`
    case 'changelog': return `=== Changelog: ${labelFromPath(s.sourcePath)} ===`
    case 'generic':
    case 'unknown':   return `=== Doc: ${s.sourcePath} ===`
  }
}

function labelFromPath(path: string): string {
  // openspec/changes/<slug>/file.md → <slug>
  // plans/<slug>/plan.md → <slug>
  // others → path
  const m = path.match(/^(?:openspec\/changes|plans)\/([^/]+)\//)
  if (m) return m[1]!
  return path
}

// ---------------------------------------------------------------------------
// Truncation precedence — drop in order until under budget.
//   1. Unknown
//   2. Generic
//   3. Older phase files (CK-Plan): we drop CK-Plan PHASES section first
//   4. OpenSpec CAPABILITIES section
//   5. PR body (truncated mid)
//   6. Title preserved
// ---------------------------------------------------------------------------

function dropSection(spec: ExtractedSpec, sectionHeading: string): ExtractedSpec {
  return {
    ...spec,
    sections: spec.sections.filter((s) => s.heading.toUpperCase() !== sectionHeading.toUpperCase()),
  }
}

export function formatIntentSection(
  meta: PRMeta | null,
  specs: ExtractedSpec[],
  budget: number,
): string {
  let prMetaBlock = formatPRMetaBlock(meta)
  let specsList = specs.slice()

  const buildHeader = (): string => {
    if (specsList.length === 0) return ''
    const lines = [`Detected spec artifacts (${specsList.length}):`]
    for (const s of specsList) {
      lines.push(`  ${s.sourcePath} (${s.class})`)
    }
    return lines.join('\n')
  }

  const compose = (): string => {
    const blocks: string[] = []
    if (prMetaBlock) blocks.push(prMetaBlock)
    const header = buildHeader()
    if (header) blocks.push(header)
    for (const s of specsList) {
      const sb = formatSpecBlock(s)
      if (sb) blocks.push(sb)
    }
    if (blocks.length === 0) return ''
    return ['=== PR INTENT ===', ...blocks, NOTES_PREAMBLE].join('\n\n')
  }

  let composed = compose()
  if (composed.length <= budget) return composed

  // Step 1: drop unknown
  specsList = specsList.filter((s) => s.class !== 'unknown')
  composed = compose()
  if (composed.length <= budget) return composed

  // Step 2: drop generic
  specsList = specsList.filter((s) => s.class !== 'generic')
  composed = compose()
  if (composed.length <= budget) return composed

  // Step 3: drop CK-Plan PHASES section across all CK-Plan entries
  specsList = specsList.map((s) => (s.class === 'ck-plan' ? dropSection(s, 'PHASES') : s))
  composed = compose()
  if (composed.length <= budget) return composed

  // Step 4: drop OpenSpec CAPABILITIES
  specsList = specsList.map((s) => (s.class === 'openspec' ? dropSection(s, 'CAPABILITIES') : s))
  composed = compose()
  if (composed.length <= budget) return composed

  // Step 5: truncate PR body further
  if (meta) {
    const reducedMeta: PRMeta = {
      ...meta,
      body: meta.body ? meta.body.slice(0, 200) + '\n... [truncated]' : '',
      linkedIssues: [],
    }
    prMetaBlock = formatPRMetaBlock(reducedMeta)
    composed = compose()
  }
  if (composed.length <= budget) return composed

  // Step 6: hard truncate trailing content but keep title + opening
  if (composed.length > budget) {
    const head = composed.slice(0, Math.max(0, budget - 40))
    composed = head + '\n... [INTENT truncated]\n==='
  }
  return composed
}
