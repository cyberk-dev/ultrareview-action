// ---------------------------------------------------------------------------
// diff-parser.ts — Parse unified diff format into structured data
// ---------------------------------------------------------------------------

/** Binary/generated file extensions to skip */
const SKIP_EXTENSIONS = ['.lock', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.eot']
const SKIP_PATHS = ['dist/', 'node_modules/', '.min.js', '-min.js']

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string   // raw hunk content with +/- markers
}

export type DiffFile = {
  path: string          // file path from +++ b/path
  oldPath?: string      // for renames, from --- a/path
  hunks: DiffHunk[]
  additions: number
  deletions: number
  isBinary: boolean
  isNew: boolean
  isDeleted: boolean
}

/** Parse unified diff text into structured DiffFile[] */
export function parseDiff(diffText: string): DiffFile[] {
  if (!diffText.trim()) return []

  // Split into per-file blocks by "diff --git" header
  const blocks = diffText.split(/^diff --git /m).filter(Boolean)
  const files: DiffFile[] = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const file = parseBlock(lines)
    if (file && shouldInclude(file)) {
      files.push(file)
    }
  }

  return files
}

function parseBlock(lines: string[]): DiffFile | null {
  let path = ''
  let oldPath: string | undefined
  let isBinary = false
  let isNew = false
  let isDeleted = false
  let additions = 0
  let deletions = 0
  const hunks: DiffHunk[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    if (line.startsWith('+++ b/')) {
      path = line.slice(6).trim()
    } else if (line.startsWith('--- a/')) {
      const p = line.slice(6).trim()
      if (p !== '/dev/null') oldPath = p
    } else if (line === '--- /dev/null') {
      isNew = true
    } else if (line === '+++ /dev/null') {
      isDeleted = true
    } else if (line.includes('Binary files')) {
      isBinary = true
    } else if (line.startsWith('@@ ')) {
      // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (!m) continue

      const oldStart = parseInt(m[1] ?? '0', 10)
      const oldLines = parseInt(m[2] ?? '1', 10)
      const newStart = parseInt(m[3] ?? '0', 10)
      const newLines = parseInt(m[4] ?? '1', 10)

      // Collect hunk content lines
      const hunkLines: string[] = [line]
      i++
      while (i < lines.length && lines[i] !== undefined && !lines[i]!.startsWith('@@ ') && !lines[i]!.startsWith('diff --git ')) {
        const l = lines[i]!
        hunkLines.push(l)
        if (l.startsWith('+')) additions++
        if (l.startsWith('-')) deletions++
        i++
      }
      i-- // outer loop will i++

      hunks.push({ oldStart, oldLines, newStart, newLines, content: hunkLines.join('\n') })
    }
  }

  if (!path) return null

  return { path, oldPath, hunks, additions, deletions, isBinary, isNew, isDeleted }
}

/** Check if file should be included in review */
function shouldInclude(file: DiffFile): boolean {
  if (file.isBinary) return false
  const lp = file.path.toLowerCase()
  if (SKIP_EXTENSIONS.some((ext) => lp.endsWith(ext))) return false
  if (SKIP_PATHS.some((seg) => lp.includes(seg))) return false
  return true
}

/**
 * Map a source line number (new-file line) to a diff position (1-based).
 * Position counts from 1 at the first hunk header line.
 * Returns null if the line is not present in any hunk.
 */
export function lineToDiffPosition(diffFile: DiffFile, sourceLine: number): number | null {
  let position = 0

  for (const hunk of diffFile.hunks) {
    const hunkLines = hunk.content.split('\n')
    let newFileLine = hunk.newStart

    for (const line of hunkLines) {
      position++

      if (line.startsWith('-')) {
        // deletion — old file only, new file line doesn't advance
        continue
      }

      // context line (+) or added line — both count in new file
      if (newFileLine === sourceLine) {
        return position
      }

      newFileLine++
    }
  }

  return null
}
