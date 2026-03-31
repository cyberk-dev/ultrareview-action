// ---------------------------------------------------------------------------
// file-reader.ts — Read a file + resolve its dependency graph for review context
// ---------------------------------------------------------------------------

import { resolve, dirname, basename, extname } from 'node:path'

/** Max lines to read per related file (import/test) */
const MAX_LINES = 500
/** Max number of related files (imports + tests combined) */
const MAX_RELATED = 10

export type FileContext = {
  path: string
  content: string
  imports: string[]                     // resolved import paths (local) or package names
  importContents: Map<string, string>   // path → content (first MAX_LINES lines)
  testFiles: string[]                   // matching test files
  testContents: Map<string, string>     // path → content (first MAX_LINES lines)
  callers: string[]                     // files that import/use this module
}

/** Truncate text to first N lines */
function truncateLines(text: string, max: number): string {
  const lines = text.split('\n')
  if (lines.length <= max) return text
  return lines.slice(0, max).join('\n') + `\n// ... (truncated at ${max} lines)`
}

/** Parse import/require paths from TypeScript/JS source */
export function parseImportPaths(source: string): string[] {
  const paths: string[] = []
  // ESM: import ... from '...'
  const esmRe = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = esmRe.exec(source)) !== null) {
    if (m[1]) paths.push(m[1])
  }
  // CJS: require('...')
  const cjsRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = cjsRe.exec(source)) !== null) {
    if (m[1]) paths.push(m[1])
  }
  return [...new Set(paths)]
}

/** Resolve a local import path to absolute; returns null for node_modules */
function resolveImport(importPath: string, fileDir: string): string | null {
  if (!importPath.startsWith('.')) return null // node_module — skip read
  return resolve(fileDir, importPath)
}

/** Try reading a file with common TS extensions if bare path doesn't exist */
async function tryReadFile(absPath: string): Promise<string | null> {
  const candidates = [
    absPath,
    absPath + '.ts',
    absPath + '.tsx',
    absPath + '.js',
    absPath + '/index.ts',
    absPath + '/index.tsx',
    absPath + '/index.js',
  ]
  for (const candidate of candidates) {
    try {
      const text = await Bun.file(candidate).text()
      return text
    } catch {
      // try next
    }
  }
  return null
}

/** Find test files for a given source file basename */
async function findTestFiles(repoRoot: string, fileBasename: string): Promise<string[]> {
  const stem = basename(fileBasename, extname(fileBasename))
  try {
    const result = await Bun.$`find ${repoRoot}/src -type f \( -name "${stem}.test.ts" -o -name "${stem}.test.tsx" -o -name "${stem}.spec.ts" -o -name "${stem}.spec.tsx" \)`.quiet().text()
    return result.trim() ? result.trim().split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

/** Find files in src/ that import this module by basename */
async function findCallers(repoRoot: string, filePath: string): Promise<string[]> {
  const stem = basename(filePath, extname(filePath))
  try {
    const result = await Bun.$`grep -rl "from.*['\"].*${stem}" ${repoRoot}/src --include="*.ts" --include="*.tsx"`.quiet().text()
    return result.trim()
      ? result.trim().split('\n').filter((p) => p !== filePath && !p.includes('node_modules'))
      : []
  } catch {
    return []
  }
}

/** Read a file and gather full context: imports, tests, callers */
export async function gatherFileContext(filePath: string, repoRoot: string): Promise<FileContext> {
  const absPath = resolve(filePath)
  const fileDir = dirname(absPath)
  const fileBasename = basename(absPath)

  // 1. Read the main file
  let content = ''
  try {
    content = await Bun.file(absPath).text()
  } catch {
    // Return empty context if file unreadable
    return {
      path: filePath,
      content: '',
      imports: [],
      importContents: new Map(),
      testFiles: [],
      testContents: new Map(),
      callers: [],
    }
  }

  // 2. Parse imports
  const rawImports = parseImportPaths(content)
  const imports: string[] = []
  const importContents = new Map<string, string>()
  let relatedCount = 0

  for (const imp of rawImports) {
    if (relatedCount >= MAX_RELATED) break
    const resolved = resolveImport(imp, fileDir)
    if (resolved === null) {
      // node_module — just record package name
      imports.push(imp)
      continue
    }
    imports.push(resolved)
    const text = await tryReadFile(resolved)
    if (text !== null) {
      importContents.set(resolved, truncateLines(text, MAX_LINES))
      relatedCount++
    }
  }

  // 3. Find test files
  const testFiles = await findTestFiles(repoRoot, fileBasename)
  const testContents = new Map<string, string>()

  for (const tf of testFiles) {
    if (relatedCount >= MAX_RELATED) break
    try {
      const text = await Bun.file(tf).text()
      testContents.set(tf, truncateLines(text, MAX_LINES))
      relatedCount++
    } catch {
      // skip
    }
  }

  // 4. Find callers (paths only, no content read)
  const callers = await findCallers(repoRoot, absPath)

  return {
    path: filePath,
    content,
    imports,
    importContents,
    testFiles,
    testContents,
    callers,
  }
}
