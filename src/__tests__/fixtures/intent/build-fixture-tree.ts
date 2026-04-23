// Build a real on-disk fixture tree under a temp dir for spec-classifier
// and extractors tests. Returns root path + a list of paths (repo-relative)
// in a typical PR diff.

import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

export type FixtureTree = {
  root: string
  paths: string[]
  cleanup: () => void
}

function w(root: string, rel: string, content: string): void {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

export function buildFixtureTree(): FixtureTree {
  const root = mkdtempSync(join(tmpdir(), 'intent-fixtures-'))

  // ---- OpenSpec (full) ----
  w(root, 'openspec/changes/auth-fix/proposal.md', [
    '# Proposal',
    '',
    '## Why',
    'Null-byte injection allows auth bypass. Severity: high.',
    '',
    '## Goals',
    'Reject control chars in token; cap token length.',
  ].join('\n'))
  w(root, 'openspec/changes/auth-fix/design.md', [
    '# Design',
    '',
    '## Approach',
    'Validator rejects tokens with control chars + length > 4KB.',
    '',
    '## Trade-offs',
    'Slight CPU cost on every request.',
  ].join('\n'))
  w(root, 'openspec/changes/auth-fix/tasks.md', [
    '# Tasks',
    '',
    '- [x] null-byte reject',
    '- [x] oversize reject',
    '- [ ] request_id log',
    '- [ ] metric emit',
  ].join('\n'))
  w(root, 'openspec/changes/auth-fix/specs/capability-1.md', [
    '# Token Validator',
    '',
    'Capability: rejects malformed tokens.',
  ].join('\n'))

  // ---- OpenSpec (partial — only proposal, no tasks) ----
  w(root, 'openspec/changes/partial-fix/proposal.md', '# Proposal\n\n## Why\nPartial spec.')

  // ---- CK-Plan (nested) ----
  w(root, 'plans/260420-auth-fix/plan.md', [
    '---',
    'title: Auth Fix',
    'status: in_progress',
    'mode: fast',
    '---',
    '',
    '# Auth Fix Plan',
    '',
    '## Overview',
    '4-phase plan to harden auth.',
    '',
    '## Success Criteria',
    '- [ ] All tests pass',
    '- [x] Validator updated',
  ].join('\n'))
  w(root, 'plans/260420-auth-fix/phase-01-validator.md', [
    '# Phase 01 — Validator',
    '',
    '## Overview',
    'Status: completed',
    '',
    'Tighten validator.',
    '',
    '## Todo List',
    '- [x] reject null bytes',
    '- [x] cap length',
    '',
    '## Success Criteria',
    'Validator rejects malformed tokens.',
  ].join('\n'))
  w(root, 'plans/260420-auth-fix/phase-02-rate-limit.md', [
    '# Phase 02 — Rate limit',
    '',
    '## Overview',
    'Status: in_progress',
    '',
    'Add rate limit per token.',
    '',
    '## Todo List',
    '- [x] design',
    '- [ ] implement',
  ].join('\n'))

  // ---- CK-Plan (flat) ----
  w(root, 'plans/flat-feature.md', [
    '---',
    'title: Flat Feature',
    'status: pending',
    '---',
    '',
    '# Flat Feature',
    '',
    '## Overview',
    'A simple flat plan.',
    '',
    '## Success Criteria',
    '- [ ] Done',
  ].join('\n'))

  // ---- Generic doc ----
  w(root, 'docs/architecture.md', [
    '# Architecture',
    '',
    '## Overview',
    'High-level architecture overview.',
    '',
    '## Random Section',
    'Should be ignored by whitelist.',
    '',
    '## Requirements',
    '- API gateway',
    '- Cache layer',
  ].join('\n'))

  // ---- Changeset ----
  w(root, '.changeset/abc.md', [
    '---',
    "'ultrareview-clone': minor",
    '---',
    '',
    'Add foo bar feature.',
  ].join('\n'))

  // ---- CHANGELOG.md ----
  w(root, 'CHANGELOG.md', [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '- New thing',
    '',
    '## [0.2.0]',
    '',
    '- Old thing',
  ].join('\n'))

  // ---- Random (unknown) ----
  w(root, 'random/notes.md', '# Notes\n\nrandom thing.')

  const paths = [
    'openspec/changes/auth-fix/proposal.md',
    'openspec/changes/auth-fix/design.md',
    'openspec/changes/auth-fix/tasks.md',
    'openspec/changes/auth-fix/specs/capability-1.md',
    'openspec/changes/partial-fix/proposal.md',
    'plans/260420-auth-fix/plan.md',
    'plans/260420-auth-fix/phase-01-validator.md',
    'plans/260420-auth-fix/phase-02-rate-limit.md',
    'plans/flat-feature.md',
    'docs/architecture.md',
    '.changeset/abc.md',
    'CHANGELOG.md',
    'random/notes.md',
  ]

  return {
    root,
    paths,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
