// ---------------------------------------------------------------------------
// BugHunter Fleet — 3 parallel AI agents per diff via cliproxy.
// Each agent specializes in a different bug category. Results are merged,
// deduplicated by title similarity, and sorted by severity.
// Prompts live in bug-hunter-prompts.ts to keep this file under 200 lines.
// ---------------------------------------------------------------------------
import { chat } from '../services/ai-client.ts'
import { AGENT_PROMPTS } from './bug-hunter-prompts.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Bug = {
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line?: number
  title: string
  description: string
  suggestion: string
  verified: boolean // true=verified, false=refuted
}

export type FleetResult = {
  bugs: Bug[]
  duration: number // ms
  flowDiagram?: string  // optional Mermaid block (since v0.3.1)
}

// ---------------------------------------------------------------------------
// Severity ordering for sort
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<Bug['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

// ---------------------------------------------------------------------------
// Parse a single agent response — returns [] on parse failure
// ---------------------------------------------------------------------------

function parseBugs(raw: string): Bug[] {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/```\s*$/m, '')
      .trim()

    const parsed = JSON.parse(cleaned) as { bugs?: unknown[] }
    if (!Array.isArray(parsed.bugs)) return []

    return parsed.bugs
      .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
      .map((b) => ({
        severity: (['critical', 'high', 'medium', 'low'].includes(String(b.severity))
          ? b.severity
          : 'low') as Bug['severity'],
        file: String(b.file ?? 'unknown'),
        line: typeof b.line === 'number' ? b.line : undefined,
        title: String(b.title ?? ''),
        description: String(b.description ?? ''),
        suggestion: String(b.suggestion ?? ''),
        verified: b.verified !== false, // default true
      }))
      .filter((b) => b.title.length > 0)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Deduplicate by title similarity (simple lowercase prefix match)
// ---------------------------------------------------------------------------

function deduplicateBugs(bugs: Bug[]): Bug[] {
  const seen = new Set<string>()
  return bugs.filter((b) => {
    const key = b.title.toLowerCase().slice(0, 40)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ---------------------------------------------------------------------------
// Call one agent — returns parsed bugs or [] on failure
// ---------------------------------------------------------------------------

async function callAgent(
  agentName: string,
  systemPrompt: string,
  diff: string,
  description: string,
): Promise<Bug[]> {
  const userMessage = [
    description ? `## PR Description\n${description}` : '',
    `## Diff\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const raw = await chat(
      [{ role: 'user', content: userMessage }],
      { system: systemPrompt, maxTokens: 2048 },
    )
    return parseBugs(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[BugHunter] Agent "${agentName}" failed: ${msg}`)
    return []
  }
}

// ---------------------------------------------------------------------------
// runBugHunterFleet — main entry point
// ---------------------------------------------------------------------------

export async function runBugHunterFleet(
  diff: string,
  description: string,
): Promise<FleetResult> {
  if (!diff || diff.trim().length === 0) {
    return { bugs: [], duration: 0 }
  }

  const start = Date.now()

  const [securityResult, logicResult, edgeCasesResult] = await Promise.allSettled([
    callAgent('security', AGENT_PROMPTS.security, diff, description),
    callAgent('logic', AGENT_PROMPTS.logic, diff, description),
    callAgent('edgeCases', AGENT_PROMPTS.edgeCases, diff, description),
  ])

  const allBugs: Bug[] = []
  for (const result of [securityResult, logicResult, edgeCasesResult]) {
    if (result.status === 'fulfilled') {
      allBugs.push(...result.value)
    }
  }

  const deduped = deduplicateBugs(allBugs)
  deduped.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return {
    bugs: deduped,
    duration: Date.now() - start,
  }
}
