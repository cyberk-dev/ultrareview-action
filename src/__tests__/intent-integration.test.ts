import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { collectIntent, mergeSpecEntries } from '../agent/intent-collector'
import { _clearSpecScanCache, type SpecFileEntry } from '../agent/spec-classifier'
import { _clearPRMetaCache } from '../agent/pr-meta-fetcher'

describe('mergeSpecEntries — dedupe by path, prefer higher confidence', () => {
  test('keeps higher-confidence entry when paths collide', () => {
    const diffEntry: SpecFileEntry = {
      path: 'plans/x/plan.md', class: 'ck-plan', confidence: 1.0, hint: 'diff',
    }
    const graphEntry: SpecFileEntry = {
      path: 'plans/x/plan.md', class: 'ck-plan', confidence: 0.5, hint: 'via GitNexus',
    }
    const out = mergeSpecEntries([diffEntry], [graphEntry])
    expect(out).toHaveLength(1)
    expect(out[0]?.confidence).toBe(1.0)
    expect(out[0]?.hint).toBe('diff')
  })

  test('combines distinct entries from both sources', () => {
    const a: SpecFileEntry = { path: 'plans/a.md', class: 'ck-plan', confidence: 0.6, hint: '' }
    const b: SpecFileEntry = { path: 'plans/b.md', class: 'ck-plan', confidence: 0.5, hint: '' }
    const out = mergeSpecEntries([a], [b])
    expect(out).toHaveLength(2)
  })

  test('empty inputs', () => {
    expect(mergeSpecEntries([], [])).toEqual([])
  })
})

function w(root: string, rel: string, content: string): void {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

describe('collectIntent — integration smoke', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'intent-int-'))
    execSync('git init -q', { cwd: repo })
    execSync('git config user.email "t@t"', { cwd: repo })
    execSync('git config user.name "t"', { cwd: repo })
    // Initial commit (no spec files yet)
    w(repo, 'README.md', '# init')
    execSync('git add . && git commit -qm init', { cwd: repo })

    // Add OpenSpec + CK-Plan + docs in second commit
    w(repo, 'openspec/changes/auth-fix/proposal.md', '# Proposal\n\n## Why\nNeed.')
    w(repo, 'openspec/changes/auth-fix/tasks.md', '- [x] done\n- [ ] todo')
    w(repo, 'openspec/changes/auth-fix/design.md', '# Design\n\n## Approach\nOk.')
    w(repo, 'plans/260420-fix/plan.md', '---\ntitle: Fix\nstatus: pending\n---\n\n# Fix\n\n## Overview\nFixing.')
    w(repo, 'plans/260420-fix/phase-01-x.md', '# Phase 01\n\n## Overview\nDo.\n\n## Todo List\n- [ ] x')
    w(repo, 'docs/architecture.md', '# Arch\n\n## Overview\nWide.')
    execSync('git add . && git commit -qm spec', { cwd: repo })

    _clearSpecScanCache()
    _clearPRMetaCache()
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('produces non-empty INTENT block with expected headings', async () => {
    // Disable PR meta (no PR context in test).
    const prevPrMeta = process.env['INTENT_PR_META']
    process.env['INTENT_PR_META'] = 'false'
    try {
      const intent = await collectIntent({ baseRef: 'HEAD~1', headRef: 'HEAD', repoPath: repo })
      expect(intent.length).toBeGreaterThan(0)
      expect(intent).toContain('=== PR INTENT ===')
      expect(intent).toContain('=== OpenSpec: auth-fix ===')
      expect(intent).toContain('=== Plan: 260420-fix ===')
      expect(intent).toContain('SPEC shows declared intent')
    } finally {
      if (prevPrMeta == null) delete process.env['INTENT_PR_META']
      else process.env['INTENT_PR_META'] = prevPrMeta
    }
  })

  test('returns empty string when INTENT_ENABLED=false', async () => {
    const prev = process.env['INTENT_ENABLED']
    process.env['INTENT_ENABLED'] = 'false'
    try {
      const intent = await collectIntent({ baseRef: 'HEAD~1', headRef: 'HEAD', repoPath: repo })
      expect(intent).toBe('')
    } finally {
      if (prev == null) delete process.env['INTENT_ENABLED']
      else process.env['INTENT_ENABLED'] = prev
    }
  })
})
