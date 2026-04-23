import { test, expect, describe } from 'bun:test'
import { formatIntentSection, formatPRMetaBlock } from '../agent/intent-formatter'
import type { PRMeta } from '../agent/pr-meta-fetcher'
import type { ExtractedSpec } from '../agent/spec-extractors'

const PR_META: PRMeta = {
  title: 'Fix auth token validation',
  body: 'Addresses null-byte injection in validator.\n\nFixes #123.',
  author: 'tunb',
  labels: ['bug', 'security'],
  linkedIssues: [
    { number: 123, title: 'Token bypass vulnerability', body: 'Repro: token containing \\0 bypasses regex check.' },
  ],
}

const OPENSPEC: ExtractedSpec = {
  class: 'openspec',
  sourcePath: 'openspec/changes/auth-fix/proposal.md',
  sections: [
    { heading: 'WHY', body: 'Security: null-byte injection allows auth bypass.' },
    { heading: 'HOW', body: 'Validator rejects tokens with control chars + length > 4KB.' },
    { heading: 'TODO', body: '2/4 done\n- [x] null-byte reject' },
    { heading: 'CAPABILITIES', body: '- Token Validator (capability-1.md)' },
  ],
  meta: { changeSlug: 'auth-fix' },
}

const CK_PLAN: ExtractedSpec = {
  class: 'ck-plan',
  sourcePath: 'plans/260420-auth-fix/plan.md',
  sections: [
    { heading: 'OVERVIEW', body: 'Title: Auth Fix\nStatus: in_progress' },
    { heading: 'PHASES', body: 'Phase: phase-01-validator.md\nStatus: completed' },
  ],
  meta: { phaseCount: '2' },
}

const GENERIC: ExtractedSpec = {
  class: 'generic',
  sourcePath: 'docs/architecture.md',
  sections: [{ heading: 'OVERVIEW', body: 'High-level architecture overview.' }],
  meta: {},
}

const UNKNOWN: ExtractedSpec = {
  class: 'unknown',
  sourcePath: 'random/notes.md',
  sections: [{ heading: 'NOTE', body: 'random note' }],
  meta: {},
}

describe('formatIntentSection', () => {
  test('empty input → empty string', () => {
    expect(formatIntentSection(null, [], 4000)).toBe('')
  })

  test('PR meta only renders title + body', () => {
    const out = formatIntentSection(PR_META, [], 4000)
    expect(out).toContain('=== PR INTENT ===')
    expect(out).toContain('Title: Fix auth token validation')
    expect(out).toContain('Author: @tunb')
    expect(out).toContain('Labels: bug, security')
    expect(out).toContain('Linked issue #123')
    expect(out).toContain('SPEC shows declared intent')
  })

  test('Spec sections rendered with headings', () => {
    const out = formatIntentSection(null, [OPENSPEC], 4000)
    expect(out).toContain('=== OpenSpec: auth-fix ===')
    expect(out).toContain('WHY:')
    expect(out).toContain('HOW:')
  })

  test('Under budget → full content preserved', () => {
    const out = formatIntentSection(PR_META, [OPENSPEC, CK_PLAN], 4000)
    expect(out.length).toBeLessThanOrEqual(4000)
    expect(out).toContain('OpenSpec')
    expect(out).toContain('Plan: 260420-auth-fix')
  })

  test('Truncation drops UNKNOWN first', () => {
    // Tiny budget — all content must compete
    const tinyBudget = 600
    const out = formatIntentSection(PR_META, [OPENSPEC, GENERIC, UNKNOWN], tinyBudget)
    expect(out).not.toContain('random/notes.md')
  })

  test('Truncation drops GENERIC after UNKNOWN', () => {
    // Budget that fits openspec but not generic
    const out = formatIntentSection(PR_META, [OPENSPEC, GENERIC], 700)
    expect(out).not.toContain('docs/architecture.md')
  })

  test('Title preserved even at extreme truncation', () => {
    const out = formatIntentSection(PR_META, [OPENSPEC, CK_PLAN, GENERIC, UNKNOWN], 200)
    expect(out).toContain('Title: Fix auth token validation')
  })

  test('Backtick + fence escape: prevents prompt-injection breakout', () => {
    const meta: PRMeta = {
      title: 'Has `backtick` and ``` fence',
      body: 'Body with ```\n# heading\n``` and `inline`',
      author: 'attacker',
      labels: [],
      linkedIssues: [],
    }
    const out = formatIntentSection(meta, [], 4000)
    // Triple backticks neutralized (no ````` left)
    expect(out.includes('```')).toBe(false)
  })

  test('formatPRMetaBlock: null → empty string', () => {
    expect(formatPRMetaBlock(null)).toBe('')
  })

  test('Snapshot: canonical output stable', () => {
    const out = formatIntentSection(PR_META, [OPENSPEC, CK_PLAN], 4000)
    // Stable structural assertions instead of full text snapshot (avoids brittle whitespace)
    expect(out.startsWith('=== PR INTENT ===')).toBe(true)
    expect(out.endsWith('===')).toBe(true)
    expect(out).toMatch(/Title:.*\n/)
    expect(out).toMatch(/=== OpenSpec: auth-fix ===/)
    expect(out).toMatch(/=== Plan: 260420-auth-fix ===/)
  })
})
