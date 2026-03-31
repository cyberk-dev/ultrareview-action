import { test, expect, describe } from 'bun:test'
import { BUG_TAXONOMY } from '../agent/bug-classifier.ts'

describe('bug-classifier', () => {
  test('BUG_TAXONOMY has 6 domains', () => {
    const domains = Object.keys(BUG_TAXONOMY)
    expect(domains).toHaveLength(6)
    expect(domains).toContain('security')
    expect(domains).toContain('logic')
    expect(domains).toContain('data')
    expect(domains).toContain('performance')
    expect(domains).toContain('api')
    expect(domains).toContain('style')
  })

  test('security domain has correct types', () => {
    const types = BUG_TAXONOMY.security
    expect(types).toHaveLength(5)
    expect(types).toContain('injection')
    expect(types).toContain('auth-bypass')
    expect(types).toContain('secret-leak')
    expect(types).toContain('path-traversal')
    expect(types).toContain('insecure-crypto')
  })

  test('logic domain has correct types', () => {
    const types = BUG_TAXONOMY.logic
    expect(types).toHaveLength(5)
    expect(types).toContain('null-reference')
    expect(types).toContain('race-condition')
    expect(types).toContain('off-by-one')
    expect(types).toContain('wrong-conditional')
    expect(types).toContain('infinite-loop')
  })

  test('data domain has correct types', () => {
    const types = BUG_TAXONOMY.data
    expect(types).toHaveLength(5)
    expect(types).toContain('missing-validation')
    expect(types).toContain('type-mismatch')
    expect(types).toContain('unhandled-error')
    expect(types).toContain('data-loss')
    expect(types).toContain('encoding-issue')
  })

  test('performance domain has correct types', () => {
    const types = BUG_TAXONOMY.performance
    expect(types).toHaveLength(4)
    expect(types).toContain('n-plus-one')
    expect(types).toContain('memory-leak')
    expect(types).toContain('blocking-io')
    expect(types).toContain('unnecessary-recompute')
  })

  test('api domain has correct types', () => {
    const types = BUG_TAXONOMY.api
    expect(types).toHaveLength(4)
    expect(types).toContain('breaking-change')
    expect(types).toContain('missing-error-handling')
    expect(types).toContain('contract-violation')
    expect(types).toContain('deprecated-usage')
  })

  test('style domain has correct types', () => {
    const types = BUG_TAXONOMY.style
    expect(types).toHaveLength(5)
    expect(types).toContain('naming-convention')
    expect(types).toContain('dead-code')
    expect(types).toContain('code-duplication')
    expect(types).toContain('magic-numbers')
    expect(types).toContain('missing-types')
  })

  test('total leaf types = 28', () => {
    let total = 0
    for (const types of Object.values(BUG_TAXONOMY)) {
      total += types.length
    }
    expect(total).toBe(28)
  })

  test('all domain values are non-empty arrays', () => {
    for (const [domain, types] of Object.entries(BUG_TAXONOMY)) {
      expect(Array.isArray(types)).toBe(true)
      expect(types.length).toBeGreaterThan(0)
      for (const type of types) {
        expect(typeof type).toBe('string')
        expect(type.length).toBeGreaterThan(0)
      }
    }
  })

  test('all bug types follow kebab-case convention', () => {
    const kebabRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/
    for (const types of Object.values(BUG_TAXONOMY)) {
      for (const type of types) {
        expect(kebabRegex.test(type)).toBe(true)
      }
    }
  })
})
