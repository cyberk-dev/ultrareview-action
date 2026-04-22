// ---------------------------------------------------------------------------
// analyzer-prompt.ts — System prompt + user prompt builder for deep analysis.
// Kept separate so deep-analyzer.ts stays under 200 lines.
// ---------------------------------------------------------------------------

import type { ReviewFile } from './context-gatherer.ts'

/** Total character budget before truncation (~60K chars ≈ 15K tokens) */
const TOTAL_CHAR_BUDGET = 60_000

/** Max chars for import summary per imported file */
const IMPORT_SNIPPET_CHARS = 2_000

/** Max chars for each test file snippet */
const TEST_SNIPPET_CHARS = 2_000

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const ANALYZER_SYSTEM_PROMPT = `You are a principal engineer at Anthropic conducting a production code review.

You have access to:
- The FULL source file (not just the diff)
- All imported modules this file depends on
- Test files that cover this code
- Other files that call/use this module

Your job:
1. Understand the INTENT of the change from the diff
2. Read the full file to understand CONTEXT
3. Check imports to understand DEPENDENCIES
4. Check tests to see what IS and ISN'T covered
5. Check callers to understand IMPACT

Find bugs that are:
- REAL: verifiable from the code you can see
- SPECIFIC: exact file:line, quote the problematic code
- ACTIONABLE: include a concrete fix, not vague advice
- IMPORTANT: skip style nitpicks unless they cause bugs

DO NOT:
- Guess about code you can't see
- Report style preferences as bugs
- Flag things that are clearly intentional patterns
- Report more than 5 bugs per file (focus on highest impact)
- Never paraphrase or reconstruct code — quote EXACT text from the provided source
- Never assume a function/variable/import exists unless you can see it in the provided files
- If unsure whether something exists, say 'NEEDS VERIFICATION' — do not assume

SEVERITY CALIBRATION:
- Rate by: real-world likelihood (how often will this path execute?) x impact (how bad when it does?)
- Don't flag theoretical worst-case if the path is rarely hit
- If code has no callers in this PR's changed files, note it but don't rate as critical

REACHABILITY RULES:
- Only report bugs in code paths currently called from entry points in this PR
- If a function has no callers in the diff or changed files, skip it unless it's a public API
- Don't report issues for dead code, commented code, or test-only paths

Respond with ONLY a JSON array of bugs. Each bug:
{
  "file": "exact/path.ts",
  "line": 42,
  "severity": "critical|high|medium|low",
  "category": "security|logic|performance|style|edge-case",
  "title": "Short descriptive title",
  "description": "Detailed explanation referencing specific code",
  "suggestion": "Concrete fix with code example",
  "evidence": "Quote the exact problematic code line(s)"
}

If no bugs found, respond with: []`

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/** Add line numbers to file content: "1: import foo\n2: const x..." */
function numberLines(content: string): string {
  return content
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n')
}

/** Truncate a string to maxChars, appending a note if cut */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `\n... (truncated at ${maxChars} chars)`
}

/**
 * Build the user message for the AI with full context.
 * Priority (highest to lowest): file content → diff hunks → imports → tests → callers → impact graph.
 * Total output is capped at TOTAL_CHAR_BUDGET chars.
 */
export function buildAnalyzerPrompt(
  reviewFile: ReviewFile,
  additionalContext?: string,
  gitNexusSection?: string,
): string {
  const { diffFile, context } = reviewFile
  const sections: string[] = []

  // --- 1. Full file content with line numbers ---
  const fileSection =
    `## FILE: ${diffFile.path}\n\`\`\`\n${numberLines(context.content)}\n\`\`\``
  sections.push(fileSection)

  // --- 2. Diff hunks ---
  if (diffFile.hunks.length > 0) {
    const hunkText = diffFile.hunks.map((h) => h.content).join('\n\n')
    sections.push(`## DIFF HUNKS\n\`\`\`diff\n${hunkText}\n\`\`\``)
  }

  // --- 3. Import summaries (first IMPORT_SNIPPET_CHARS chars of each) ---
  if (context.importContents.size > 0) {
    const importParts: string[] = []
    for (const [path, content] of context.importContents) {
      importParts.push(`### ${path}\n\`\`\`\n${truncate(content, IMPORT_SNIPPET_CHARS)}\n\`\`\``)
    }
    sections.push(`## IMPORTED FILES\n${importParts.join('\n\n')}`)
  }

  // --- 4. Test file snippets ---
  if (context.testContents.size > 0) {
    const testParts: string[] = []
    for (const [path, content] of context.testContents) {
      testParts.push(`### ${path}\n\`\`\`\n${truncate(content, TEST_SNIPPET_CHARS)}\n\`\`\``)
    }
    sections.push(`## TEST FILES\n${testParts.join('\n\n')}`)
  }

  // --- 5. Callers (paths only) ---
  if (context.callers.length > 0) {
    const callerList = context.callers.slice(0, 10).join('\n')
    sections.push(
      `## CALLERS (${context.callers.length} file(s) import this module)\n${callerList}`,
    )
  }

  // --- 6. GitNexus IMPACT GRAPH (callers, callees, process chains) ---
  // Injected only when non-empty so existing prompt snapshots are unaffected.
  if (gitNexusSection) {
    sections.push(`## IMPACT GRAPH\n${gitNexusSection}`)
  }

  // --- 7. Additional analysis context (async issues, schema issues, deletions) ---
  if (additionalContext) {
    sections.push(`## ADDITIONAL ANALYSIS CONTEXT\n${additionalContext}`)
  }

  const full = sections.join('\n\n')
  return truncate(full, TOTAL_CHAR_BUDGET)
}
