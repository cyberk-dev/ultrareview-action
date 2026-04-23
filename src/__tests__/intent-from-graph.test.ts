import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { collectSpecsFromGraph, deriveQueryString } from '../agent/intent-from-graph'

describe('deriveQueryString', () => {
  test('combines title + path slugs + symbols, dedupes, caps length', () => {
    const out = deriveQueryString(
      'feat(face-scan): Phase 06 MediaPipe Face Landmarker',
      [
        'apps/native/modules/mediapipe-face-landmarker/index.ts',
        'apps/native/src/features/face-scan/lib/zone-cropper.ts',
      ],
      ['ZoneCropper', 'extractLandmarks', 'detectFace'],
    )
    expect(out).toContain('Phase 06')
    expect(out).toContain('MediaPipe')
    expect(out).toContain('mediapipe-face-landmarker')
    expect(out).toContain('zone-cropper')
    expect(out).toContain('ZoneCropper')
    // Skip-list path segments don't show up
    expect(out).not.toMatch(/\bsrc\b/)
    expect(out).not.toMatch(/\blib\b/)
    expect(out.length).toBeLessThanOrEqual(300)
  })

  test('handles empty title and empty inputs', () => {
    expect(deriveQueryString(undefined, [], [])).toBe('')
    expect(deriveQueryString('', [], [])).toBe('')
  })

  test('strips markdown special chars from title', () => {
    const out = deriveQueryString('**Bold** _italic_ `code`', [], [])
    expect(out).not.toContain('`')
    expect(out).not.toContain('*')
    expect(out).not.toContain('_')
  })
})

describe('collectSpecsFromGraph — disable + early exits', () => {
  let prevBridge: string | undefined
  let prevGitnexus: string | undefined

  beforeEach(() => {
    prevBridge = process.env['INTENT_GRAPH_BRIDGE']
    prevGitnexus = process.env['GITNEXUS_ENABLED']
  })

  afterEach(() => {
    if (prevBridge == null) delete process.env['INTENT_GRAPH_BRIDGE']
    else process.env['INTENT_GRAPH_BRIDGE'] = prevBridge
    if (prevGitnexus == null) delete process.env['GITNEXUS_ENABLED']
    else process.env['GITNEXUS_ENABLED'] = prevGitnexus
  })

  test('INTENT_GRAPH_BRIDGE=false → returns []', async () => {
    process.env['INTENT_GRAPH_BRIDGE'] = 'false'
    const out = await collectSpecsFromGraph({
      baseRef: 'a', headRef: 'b', repoPath: '/tmp', changedFiles: ['src/x.ts'],
    })
    expect(out).toEqual([])
  })

  test('GITNEXUS_ENABLED=false → returns []', async () => {
    process.env['GITNEXUS_ENABLED'] = 'false'
    const out = await collectSpecsFromGraph({
      baseRef: 'a', headRef: 'b', repoPath: '/tmp', changedFiles: ['src/x.ts'],
    })
    expect(out).toEqual([])
  })

  test('no repoPath → returns []', async () => {
    const out = await collectSpecsFromGraph({
      baseRef: 'a', headRef: 'b', repoPath: '', changedFiles: ['src/x.ts'],
    })
    expect(out).toEqual([])
  })

  test('no PR title and no changed files → returns []', async () => {
    const out = await collectSpecsFromGraph({
      baseRef: 'a', headRef: 'b', repoPath: '/tmp', changedFiles: [],
    })
    expect(out).toEqual([])
  })

  test('GitNexus binary missing → graceful skip → []', async () => {
    // Force PATH that lacks gitnexus to make resolveRepoName / query fail.
    const prevPath = process.env['PATH']
    process.env['PATH'] = '/nonexistent-bin'
    process.env['GITNEXUS_BIN'] = 'definitely-not-installed-xyz'
    try {
      const out = await collectSpecsFromGraph({
        baseRef: 'a', headRef: 'b', repoPath: '/tmp',
        prTitle: 'Some PR', changedFiles: ['src/x.ts'],
      })
      expect(out).toEqual([])
    } finally {
      if (prevPath != null) process.env['PATH'] = prevPath
      delete process.env['GITNEXUS_BIN']
    }
  })
})
