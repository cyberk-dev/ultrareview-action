import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { extractByClass } from '../agent/spec-extractors'
import { buildFixtureTree, type FixtureTree } from './fixtures/intent/build-fixture-tree'

describe('spec-extractors', () => {
  let tree: FixtureTree

  beforeEach(() => {
    tree = buildFixtureTree()
  })

  afterEach(() => {
    tree.cleanup()
  })

  test('OpenSpec extractor: WHY/HOW/TODO/CAPABILITIES populated', () => {
    const r = extractByClass(
      { path: 'openspec/changes/auth-fix/proposal.md', class: 'openspec', confidence: 1, hint: '' },
      tree.root,
    )
    expect(r.class).toBe('openspec')
    const headings = r.sections.map((s) => s.heading)
    expect(headings).toContain('WHY')
    expect(headings).toContain('HOW')
    expect(headings).toContain('TODO')
    expect(headings).toContain('CAPABILITIES')
    expect(r.meta?.todoTotal).toBe('4')
    expect(r.meta?.todoDone).toBe('2')
    expect(r.meta?.changeSlug).toBe('auth-fix')
  })

  test('OpenSpec extractor: missing siblings → error meta, no sections', () => {
    // Only proposal exists for partial-fix
    const r = extractByClass(
      { path: 'openspec/changes/partial-fix/proposal.md', class: 'openspec', confidence: 0.8, hint: '' },
      tree.root,
    )
    // proposal exists → WHY section produced
    expect(r.sections.some((s) => s.heading === 'WHY')).toBe(true)
  })

  test('CK-Plan extractor (nested): aggregates phases', () => {
    const r = extractByClass(
      { path: 'plans/260420-auth-fix/plan.md', class: 'ck-plan', confidence: 1, hint: '' },
      tree.root,
    )
    expect(r.class).toBe('ck-plan')
    expect(r.meta?.form).toBe('nested')
    expect(parseInt(r.meta?.phaseCount ?? '0', 10)).toBeGreaterThanOrEqual(2)
    const headings = r.sections.map((s) => s.heading)
    expect(headings).toContain('PHASES')
  })

  test('CK-Plan extractor (flat): single-section extract', () => {
    const r = extractByClass(
      { path: 'plans/flat-feature.md', class: 'ck-plan', confidence: 0.6, hint: '' },
      tree.root,
    )
    expect(r.meta?.form).toBe('flat')
    const headings = r.sections.map((s) => s.heading)
    expect(headings).toContain('OVERVIEW')
  })

  test('Generic extractor: H2 whitelist matches only', () => {
    const r = extractByClass(
      { path: 'docs/architecture.md', class: 'generic', confidence: 0.7, hint: '' },
      tree.root,
    )
    expect(r.class).toBe('generic')
    const headings = r.sections.map((s) => s.heading.toLowerCase())
    expect(headings).toContain('overview')
    expect(headings).toContain('requirements')
    expect(headings).not.toContain('random section')
  })

  test('Generic extractor: env override INTENT_GENERIC_HEADINGS', () => {
    const prev = process.env['INTENT_GENERIC_HEADINGS']
    process.env['INTENT_GENERIC_HEADINGS'] = 'Random Section'
    try {
      const r = extractByClass(
        { path: 'docs/architecture.md', class: 'generic', confidence: 0.7, hint: '' },
        tree.root,
      )
      const headings = r.sections.map((s) => s.heading.toLowerCase())
      expect(headings).toContain('random section')
      expect(headings).not.toContain('overview')
    } finally {
      if (prev == null) delete process.env['INTENT_GENERIC_HEADINGS']
      else process.env['INTENT_GENERIC_HEADINGS'] = prev
    }
  })

  test('Changelog (.changeset entry): bump type detected, body extracted', () => {
    const r = extractByClass(
      { path: '.changeset/abc.md', class: 'changelog', confidence: 1, hint: '' },
      tree.root,
    )
    expect(r.class).toBe('changelog')
    expect(r.meta?.bumpType).toBe('minor')
    expect(r.sections[0]?.body).toContain('Add foo bar')
  })

  test('Changelog (CHANGELOG.md): first version section extracted', () => {
    const r = extractByClass(
      { path: 'CHANGELOG.md', class: 'changelog', confidence: 1, hint: '' },
      tree.root,
    )
    expect(r.sections[0]?.body).toContain('Unreleased')
    expect(r.sections[0]?.body).not.toContain('0.2.0')
  })

  test('Extractor: never throws on missing file → error meta', () => {
    const r = extractByClass(
      { path: 'docs/nonexistent.md', class: 'generic', confidence: 0.7, hint: '' },
      tree.root,
    )
    expect(r.sections).toEqual([])
    expect(r.meta?.error).toBeDefined()
  })
})
