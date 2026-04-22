// ---------------------------------------------------------------------------
// gitnexus-diff.ts — git diff helpers for changed-file and hunk-range extraction
// Uses execFile (no shell). Called by gitnexus-tracer.ts to derive changed symbols.
// ---------------------------------------------------------------------------

import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/** Line range [startLine, endLine] — both inclusive, 1-based. */
export type HunkRange = [number, number]

/**
 * Return list of files changed between base..head.
 * Uses `git diff --name-only base..head` — output is relative paths from repo root.
 * Never throws — returns [] on any error.
 */
export async function getChangedFiles(
  base: string,
  head: string,
  repoPath: string,
): Promise<string[]> {
  try {
    const { stdout } = await execFile(
      'git',
      ['diff', '--name-only', `${base}..${head}`],
      { cwd: repoPath, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout.split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

// -- Hunk line parser --

/**
 * Parse `@@ -X[,Y] +A[,B] @@` lines from unified diff.
 * Returns NEW-FILE ranges (the + side) as [startLine, endLine] (inclusive, 1-based).
 * When B is omitted, it means a single-line hunk (B=1).
 * When B=0 it is a pure deletion — skip (no new lines).
 */
function parseHunkHeader(line: string): HunkRange | null {
  // Match: @@ -digits[,digits] +digits[,digits] @@
  const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
  if (!m) return null
  const start = parseInt(m[1] ?? '1', 10)
  const count = m[2] !== undefined ? parseInt(m[2], 10) : 1 // omitted = single-line
  if (count === 0) return null // pure deletion
  return [start, start + count - 1]
}

/**
 * Return new-file hunk line ranges for a single file between base..head.
 * Uses `git diff --unified=0` so hunk headers have minimal context.
 * Never throws — returns [] on any error.
 */
export async function getHunkRanges(
  base: string,
  head: string,
  file: string,
  repoPath: string,
): Promise<HunkRange[]> {
  try {
    const { stdout } = await execFile(
      'git',
      ['diff', '--unified=0', `${base}..${head}`, '--', file],
      { cwd: repoPath, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
    )
    const ranges: HunkRange[] = []
    for (const line of stdout.split('\n')) {
      if (!line.startsWith('@@')) continue
      const range = parseHunkHeader(line)
      if (range) ranges.push(range)
    }
    return ranges
  } catch {
    return []
  }
}

/**
 * Check whether a symbol range [symStart, symEnd] overlaps any hunk range.
 * Overlap condition: symStart <= hunkEnd AND symEnd >= hunkStart.
 */
export function overlapsAnyHunk(
  symStart: number,
  symEnd: number,
  hunks: HunkRange[],
): boolean {
  for (const [hStart, hEnd] of hunks) {
    if (symStart <= hEnd && symEnd >= hStart) return true
  }
  return false
}
