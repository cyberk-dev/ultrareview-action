import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { extractIssueRefs, fetchPRMeta, _clearPRMetaCache, resolveCurrentPR } from '../agent/pr-meta-fetcher'
import { setupMockCliBin, type MockCliHandle } from './helpers/mock-cli-bin'

describe('extractIssueRefs', () => {
  test('captures fixes/closes/resolves + bare #N, dedupes, caps at 5', () => {
    const body = 'fixes #123 then closes #99 also bare #456 plus #99 again #1 #2 #3 #4 #5 #6 #7'
    const refs = extractIssueRefs(body)
    expect(refs.length).toBeLessThanOrEqual(5)
    expect(refs).toContain(123)
    expect(refs).toContain(99)
    expect(refs).toContain(456)
    expect(new Set(refs).size).toBe(refs.length)
  })

  test('empty body → []', () => {
    expect(extractIssueRefs('')).toEqual([])
  })

  test('no refs → []', () => {
    expect(extractIssueRefs('A normal body without any references.')).toEqual([])
  })
})

describe('fetchPRMeta — graceful failure paths', () => {
  let prevPath: string | undefined

  beforeEach(() => {
    _clearPRMetaCache()
    prevPath = process.env['PATH']
  })

  afterEach(() => {
    if (prevPath !== undefined) process.env['PATH'] = prevPath
    _clearPRMetaCache()
  })

  test('returns null on missing/failed gh', async () => {
    // Point PATH at a clearly non-existent dir so `gh` is not found.
    process.env['PATH'] = '/nonexistent-bin-dir-xyz'
    const out = await fetchPRMeta({ owner: 'foo', repo: 'bar', prNumber: 1 })
    expect(out).toBeNull()
  })

  test('rejects invalid input → null without spawn', async () => {
    expect(await fetchPRMeta({ owner: '', repo: 'bar', prNumber: 1 })).toBeNull()
    expect(await fetchPRMeta({ owner: 'foo', repo: 'bar', prNumber: 0 })).toBeNull()
    expect(await fetchPRMeta({ owner: 'foo', repo: 'bar', prNumber: -1 })).toBeNull()
  })
})

describe('fetchPRMeta — happy path with mock gh', () => {
  let mock: MockCliHandle
  let prevPath: string | undefined

  beforeEach(() => {
    _clearPRMetaCache()
    prevPath = process.env['PATH']
    mock = setupMockCliBin({
      toolName: 'gh',
      fixtures: {
        // The fetcher invokes:
        //   gh api repos/foo/bar/pulls/1 --jq '{title, body, ...}'
        // Our shell script slugifies args → key. Provide a default-arg fallback file.
        api: JSON.stringify({
          title: 'Hello',
          body: 'Body fixes #42',
          user: { login: 'tester' },
          labels: ['bug'],
        }),
      },
    })
    process.env['PATH'] = `${mock.binDir}:${prevPath ?? ''}`
  })

  afterEach(() => {
    if (prevPath !== undefined) process.env['PATH'] = prevPath
    mock.cleanup()
    _clearPRMetaCache()
  })

  test('returns populated PRMeta + memoizes', async () => {
    const a = await fetchPRMeta({ owner: 'foo', repo: 'bar', prNumber: 1 })
    expect(a).not.toBeNull()
    expect(a?.title).toBe('Hello')
    expect(a?.author).toBe('tester')
    expect(a?.labels).toContain('bug')

    // Memoization: second call returns identical reference / cached value.
    const b = await fetchPRMeta({ owner: 'foo', repo: 'bar', prNumber: 1 })
    expect(b).toBe(a)
  })
})

describe('resolveCurrentPR', () => {
  let prevRepo: string | undefined
  let prevPr: string | undefined

  beforeEach(() => {
    prevRepo = process.env['GITHUB_REPOSITORY']
    prevPr = process.env['PR_NUMBER']
  })

  afterEach(() => {
    if (prevRepo == null) delete process.env['GITHUB_REPOSITORY']
    else process.env['GITHUB_REPOSITORY'] = prevRepo
    if (prevPr == null) delete process.env['PR_NUMBER']
    else process.env['PR_NUMBER'] = prevPr
  })

  test('reads GITHUB_REPOSITORY + PR_NUMBER env', async () => {
    process.env['GITHUB_REPOSITORY'] = 'acme/widget'
    process.env['PR_NUMBER'] = '42'
    const out = await resolveCurrentPR()
    expect(out).toEqual({ owner: 'acme', repo: 'widget', prNumber: 42 })
  })

  test('returns null when env unset and gh fails', async () => {
    delete process.env['GITHUB_REPOSITORY']
    delete process.env['PR_NUMBER']
    const prevPath = process.env['PATH']
    process.env['PATH'] = '/nonexistent'
    try {
      const out = await resolveCurrentPR()
      expect(out).toBeNull()
    } finally {
      if (prevPath != null) process.env['PATH'] = prevPath
    }
  })
})
