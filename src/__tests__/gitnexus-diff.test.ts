import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getChangedFiles, getHunkRanges } from '../agent/gitnexus-diff'

describe('gitnexus-diff', () => {
  let repoDir: string

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitnexus-diff-test-'))
    // Initialize git repo
    execSync('git init', { cwd: repoDir })
    execSync('git config user.email "test@test.com"', { cwd: repoDir })
    execSync('git config user.name "Test User"', { cwd: repoDir })
  })

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  test('getHunkRanges parses simple hunk header from diff output', async () => {
    // Create two commits
    writeFileSync(join(repoDir, 'test.ts'), 'line1\nline2\nline3\n')
    execSync('git add test.ts', { cwd: repoDir })
    execSync('git commit -m "initial"', { cwd: repoDir })

    writeFileSync(join(repoDir, 'test.ts'), 'line1\nnewline\nline2\nline3\n')
    execSync('git add test.ts', { cwd: repoDir })
    execSync('git commit -m "modify"', { cwd: repoDir })

    // Get hunk ranges for the file diff
    const ranges = await getHunkRanges('HEAD~1', 'HEAD', 'test.ts', repoDir)
    expect(Array.isArray(ranges)).toBe(true)
    expect(ranges.length).toBeGreaterThan(0)
    // Range should be [startLine, endLine] tuples
    const firstRange = ranges[0]
    expect(Array.isArray(firstRange)).toBe(true)
    expect(firstRange?.length).toBe(2)
  })

  test('getHunkRanges handles multiple hunks', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5\n'
    writeFileSync(join(repoDir, 'test.ts'), content)
    execSync('git add test.ts', { cwd: repoDir })
    execSync('git commit -m "initial"', { cwd: repoDir })

    const modified = 'newline1\nline2\nline3\nline4\nnewline5\n'
    writeFileSync(join(repoDir, 'test.ts'), modified)
    execSync('git add test.ts', { cwd: repoDir })
    execSync('git commit -m "modify"', { cwd: repoDir })

    const ranges = await getHunkRanges('HEAD~1', 'HEAD', 'test.ts', repoDir)
    expect(Array.isArray(ranges)).toBe(true)
  })

  test('getChangedFiles returns empty array when no changes', async () => {
    writeFileSync(join(repoDir, 'file1.txt'), 'content1')
    execSync('git add file1.txt', { cwd: repoDir })
    execSync('git commit -m "initial"', { cwd: repoDir })

    // Get diff between HEAD and HEAD (no changes)
    const files = await getChangedFiles('HEAD', 'HEAD', repoDir)
    expect(Array.isArray(files)).toBe(true)
    expect(files).toHaveLength(0)
  })

  test('getChangedFiles detects modifications between two commits', async () => {
    // Create first commit
    writeFileSync(join(repoDir, 'file1.ts'), 'function hello() { return 1 }')
    execSync('git add file1.ts', { cwd: repoDir })
    execSync('git commit -m "initial"', { cwd: repoDir })

    // Modify file
    writeFileSync(join(repoDir, 'file1.ts'), 'function hello() { return 2 }\nfunction world() { return 3 }')
    execSync('git add file1.ts', { cwd: repoDir })
    execSync('git commit -m "modify"', { cwd: repoDir })

    const files = await getChangedFiles('HEAD~1', 'HEAD', repoDir)
    expect(files).toContain('file1.ts')
  })

  test('getChangedFiles detects additions', async () => {
    writeFileSync(join(repoDir, 'old.ts'), 'old content')
    execSync('git add old.ts', { cwd: repoDir })
    execSync('git commit -m "initial"', { cwd: repoDir })

    writeFileSync(join(repoDir, 'new.ts'), 'new file content')
    execSync('git add new.ts', { cwd: repoDir })
    execSync('git commit -m "add file"', { cwd: repoDir })

    const files = await getChangedFiles('HEAD~1', 'HEAD', repoDir)
    expect(files.some(f => f === 'new.ts')).toBe(true)
  })

  test('getChangedFiles detects deletions', async () => {
    writeFileSync(join(repoDir, 'to-delete.ts'), 'content')
    execSync('git add to-delete.ts', { cwd: repoDir })
    execSync('git commit -m "add"', { cwd: repoDir })

    execSync('git rm to-delete.ts', { cwd: repoDir })
    execSync('git commit -m "delete"', { cwd: repoDir })

    const files = await getChangedFiles('HEAD~1', 'HEAD', repoDir)
    expect(files.some(f => f === 'to-delete.ts')).toBe(true)
  })

  test('getChangedFiles handles errors gracefully', async () => {
    // Try to diff nonexistent refs
    const files = await getChangedFiles('nonexistent1', 'nonexistent2', repoDir)
    expect(Array.isArray(files)).toBe(true)
    expect(files).toHaveLength(0)
  })
})
