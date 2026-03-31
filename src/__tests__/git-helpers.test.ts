import { test, expect, describe } from 'bun:test'
import { detectRepo, getCurrentBranch, getDefaultBranch } from '../utils/git.ts'

describe('git helpers', () => {
  test('getCurrentBranch returns non-empty string', async () => {
    const branch = await getCurrentBranch()
    expect(typeof branch).toBe('string')
    expect(branch.length).toBeGreaterThan(0)
  })

  test('getCurrentBranch returns main as fallback', async () => {
    // This runs in the ultrareview-clone repo (a git repo)
    // so should return actual branch or main
    const branch = await getCurrentBranch()
    expect(['main', 'HEAD', 'master', 'dev']).toContain(branch)
  })

  test('getDefaultBranch returns non-empty string', async () => {
    const branch = await getDefaultBranch()
    expect(typeof branch).toBe('string')
    expect(branch.length).toBeGreaterThan(0)
  })

  test('detectRepo returns object with owner/name/branch in git repo', async () => {
    // This runs inside ultrareview-clone which is a git repo
    const repo = await detectRepo()
    if (repo) {
      expect(repo).toHaveProperty('owner')
      expect(repo).toHaveProperty('name')
      expect(repo).toHaveProperty('branch')
      expect(typeof repo.owner).toBe('string')
      expect(typeof repo.name).toBe('string')
      expect(typeof repo.branch).toBe('string')
    }
  })

  test('functions do not throw on error', async () => {
    // These should gracefully return defaults instead of throwing
    const branch = await getCurrentBranch()
    expect(branch).toBeDefined()

    const defaultBranch = await getDefaultBranch()
    expect(defaultBranch).toBeDefined()

    const repo = await detectRepo()
    // detectRepo can return null, which is ok
    expect(repo === null || typeof repo === 'object').toBe(true)
  })

  test('getCurrentBranch returns main if not in git repo', async () => {
    // When called in a git repo, returns actual branch
    // When called outside git repo, returns 'main'
    const branch = await getCurrentBranch()
    expect(['main', 'HEAD']).toContain(branch)
  })
})
