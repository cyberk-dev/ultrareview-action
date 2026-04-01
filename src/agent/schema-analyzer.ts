// ---------------------------------------------------------------------------
// schema-analyzer.ts — Detect DB schema issues in changed files (no AI calls)
// ---------------------------------------------------------------------------

import type { ReviewFile } from './context-gatherer.ts'

export type SchemaIssueKind =
  | 'missing-index'
  | 'missing-fk-constraint'
  | 'removed-validation'
  | 'missing-primary-key'

export type SchemaIssue = {
  file: string
  line: number
  kind: SchemaIssueKind
  severity: 'high' | 'medium'
  description: string
  evidence: string
  table?: string
  column?: string
}

type TableDef = {
  name: string
  columns: string[]
  indexes: string[]    // indexed column names
  foreignKeys: string[] // column names with FK
  file: string
}

const DB_PATH_PATTERNS = /schema|migration|prisma|drizzle/i
const DB_CONTENT_KEYWORDS = /\b(SELECT|INSERT|CREATE TABLE|pgTable|model)\b/

/** True when the file looks database-related by path or content */
export function isDatabaseRelated(filePath: string, content: string): boolean {
  return DB_PATH_PATTERNS.test(filePath) || DB_CONTENT_KEYWORDS.test(content)
}

/** Extract TableDef list from Drizzle / Prisma / raw SQL content */
export function parseSchemaDefinitions(content: string, filePath: string): TableDef[] {
  const tables: TableDef[] = []

  // --- Drizzle ---
  const drizzleRe = /pgTable\s*\(\s*['"](\w+)['"]/g
  let m: RegExpExecArray | null
  while ((m = drizzleRe.exec(content)) !== null) {
    const indexRe = /index\s*\(\s*['"]?\w+['"]?\s*\)\s*\.on\s*\(\s*\w+\.(\w+)/g
    const indexes: string[] = []
    let im: RegExpExecArray | null
    while ((im = indexRe.exec(content)) !== null) indexes.push(im[1]!)
    tables.push({ name: m[1]!, columns: [], indexes, foreignKeys: [], file: filePath })
  }

  // --- Prisma ---
  const prismaModelRe = /model\s+(\w+)\s*\{([^}]+)\}/g
  while ((m = prismaModelRe.exec(content)) !== null) {
    const block = m[2] ?? ''
    const indexes = [...block.matchAll(/@@index\s*\(\[([^\]]+)\]/g)].flatMap((r) =>
      (r[1] ?? '').split(',').map((c) => c.trim()),
    )
    const foreignKeys = [...block.matchAll(/@relation/g)].map(() => 'relation-field')
    tables.push({ name: m[1]!, columns: [], indexes, foreignKeys, file: filePath })
  }

  // --- SQL ---
  const sqlTableRe = /CREATE TABLE\s+["']?(\w+)/gi
  while ((m = sqlTableRe.exec(content)) !== null) {
    tables.push({ name: m[1]!, columns: [], indexes: [], foreignKeys: [], file: filePath })
  }
  // Attach SQL index info to matching tables
  const sqlIndexRe = /CREATE INDEX.*ON\s+["']?(\w+)["']?\s*\(([^)]+)\)/gi
  while ((m = sqlIndexRe.exec(content)) !== null) {
    const tbl = tables.find((t) => t.name === m![1])
    if (tbl) tbl.indexes.push(...(m[2] ?? '').split(',').map((c) => c.trim()))
  }

  return tables
}

/** Find queries that filter/sort on non-indexed columns */
export function findQueryIssues(
  content: string,
  filePath: string,
  tables: TableDef[],
): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const whereRe = /(?:WHERE|ORDER BY)\s+["'`]?(\w+)["'`]?\s*[=<>]/gi
  let m: RegExpExecArray | null
  while ((m = whereRe.exec(content)) !== null) {
    const col = m[1]!
    for (const tbl of tables) {
      if (tbl.indexes.length > 0 && !tbl.indexes.includes(col)) {
        const lineNo = content.slice(0, m.index).split('\n').length
        issues.push({
          file: filePath,
          line: lineNo,
          kind: 'missing-index',
          severity: 'medium',
          description: `Column '${col}' used in WHERE/ORDER BY but not indexed on table '${tbl.name}'`,
          evidence: m[0].trim(),
          table: tbl.name,
          column: col,
        })
      }
    }
  }
  return issues
}

/** Main export — analyze schema issues across all changed files */
export async function analyzeSchema(files: ReviewFile[], repoRoot: string): Promise<SchemaIssue[]> {
  const dbFiles = files.filter((f) =>
    isDatabaseRelated(f.diffFile.path, f.context.content ?? ''),
  )
  if (dbFiles.length === 0) return []

  // Parse definitions from changed files
  const tables: TableDef[] = dbFiles.flatMap((f) =>
    parseSchemaDefinitions(f.context.content ?? '', f.diffFile.path),
  )

  // Also scan for schema files in repoRoot
  try {
    const glob = new Bun.Glob('**/{schema,migrations,prisma}/**/*.{ts,sql,prisma}')
    for await (const rel of glob.scan({ cwd: repoRoot, dot: false })) {
      if (rel.includes('node_modules/')) continue
      const abs = `${repoRoot}/${rel}`
      const text = await Bun.file(abs).text().catch(() => '')
      if (text) tables.push(...parseSchemaDefinitions(text, rel))
    }
  } catch {
    // non-fatal: glob scan unavailable
  }

  return dbFiles.flatMap((f) =>
    findQueryIssues(f.context.content ?? '', f.diffFile.path, tables),
  )
}

/** Format issues as markdown for injection into the analyzer prompt */
export function formatSchemaContext(issues: SchemaIssue[]): string {
  if (issues.length === 0) return ''
  const lines = issues.map(
    (i) => `- [${i.file}:${i.line}] ${i.kind} (${i.severity}): ${i.description}`,
  )
  return `## SCHEMA ISSUES DETECTED\n${lines.join('\n')}\n`
}
