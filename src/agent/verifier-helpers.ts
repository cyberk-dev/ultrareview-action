// ---------------------------------------------------------------------------
// verifier-helpers.ts — Deterministic helpers for evidence and symbol verification.
// Extracted from verifier.ts to keep both files under 200 lines.
// ---------------------------------------------------------------------------

/** Keywords to exclude from symbol extraction (not meaningful identifiers) */
const KEYWORDS = new Set([
  'if', 'else', 'return', 'const', 'let', 'var', 'async', 'await',
  'function', 'class', 'new', 'throw', 'catch', 'try', 'finally',
  'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'import', 'export', 'default', 'from', 'of', 'in', 'typeof',
  'instanceof', 'void', 'delete', 'this', 'super', 'true', 'false',
  'null', 'undefined', 'NaN', 'Infinity', 'type', 'interface',
  'extends', 'implements', 'static', 'readonly', 'enum', 'as',
])

// ---------------------------------------------------------------------------
// Normalize whitespace for comparison
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Strict evidence match: every non-empty evidence line must appear in source
// ---------------------------------------------------------------------------

/**
 * Check if evidence text appears in the source context.
 * Normalizes whitespace, splits evidence into lines, checks each line.
 * Returns true only if ALL non-empty lines are found.
 */
export function strictEvidenceMatch(evidence: string, sourceContext: string): boolean {
  if (!evidence || !evidence.trim()) return false

  const normSource = normalize(sourceContext)

  // Strip line number prefixes from source context (format: "42: code here")
  const sourceWithoutLineNums = sourceContext
    .split('\n')
    .map((line) => line.replace(/^\d+:\s*/, ''))
    .join('\n')
  const normSourceNoNums = normalize(sourceWithoutLineNums)

  const evidenceLines = evidence
    .split('\n')
    .map((l) => normalize(l))
    .filter((l) => l.length > 0)

  if (evidenceLines.length === 0) return false

  return evidenceLines.every(
    (line) => normSource.includes(line) || normSourceNoNums.includes(line),
  )
}

// ---------------------------------------------------------------------------
// Extract referenced symbols (function names, variable names) from text
// ---------------------------------------------------------------------------

/**
 * Extract identifier names from evidence and description text.
 * Looks for: function calls (foo()), member access (this.foo, obj.bar),
 * and standalone identifiers that look like code symbols.
 */
export function extractReferencedSymbols(evidence: string, description: string): string[] {
  const text = `${evidence}\n${description}`
  const symbols = new Set<string>()

  // Function calls: word followed by ( — min 3 chars to avoid short names like db()
  for (const match of text.matchAll(/\b([a-zA-Z_]\w{2,})\s*\(/g)) {
    const name = match[1]!
    if (!KEYWORDS.has(name.toLowerCase())) symbols.add(name)
  }

  // Member access: this.xxx or obj.xxx
  for (const match of text.matchAll(/\b(?:this|self)\.([a-zA-Z_]\w+)/g)) {
    symbols.add(match[1]!)
  }

  // Dotted access: foo.bar (capture bar)
  for (const match of text.matchAll(/\b[a-zA-Z_]\w+\.([a-zA-Z_]\w+)/g)) {
    const name = match[1]!
    if (!KEYWORDS.has(name.toLowerCase()) && name.length > 2) symbols.add(name)
  }

  return [...symbols]
}

// ---------------------------------------------------------------------------
// Verify symbols exist in source file content
// ---------------------------------------------------------------------------

/**
 * Check if each symbol exists anywhere in the full source file.
 * Returns found and missing symbol lists.
 */
export function verifySymbols(
  symbols: string[],
  fileContent: string,
): { found: string[]; missing: string[] } {
  const found: string[] = []
  const missing: string[] = []

  for (const symbol of symbols) {
    if (fileContent.includes(symbol)) {
      found.push(symbol)
    } else {
      missing.push(symbol)
    }
  }

  return { found, missing }
}
