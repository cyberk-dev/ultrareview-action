/**
 * flow-diagram.ts — Generates a Mermaid `flowchart TD` summarizing the bot's
 * understanding of the PR's code paths. Embedded at the top of the PR review
 * comment as a collapsed `<details>` block so reviewer + author can verify
 * the bot's interpretation in one glance.
 *
 * Defaults to `gpt-5.4-mini` (cheapest viable on cyberk proxy per April-2026
 * smoke test — kimi-k2.5 had 15x prompt-token overhead from injected context).
 *
 * Graceful skip on every failure path; never throws.
 */

import { chat as defaultChat, type Message } from '../services/ai-client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowDiagramBugRef = {
  file: string
  line: number
  title: string
  severity: string
}

export type FlowDiagramInput = {
  changedFiles: string[]
  gitNexusSections: Map<string, string>
  intentSection?: string
  verifiedBugs: FlowDiagramBugRef[]
}

type ChatFn = typeof defaultChat

// ---------------------------------------------------------------------------
// Constants & env
// ---------------------------------------------------------------------------

const DEFAULT_MAX_NODES = 10
const IMPACT_GRAPH_BUDGET_CHARS = 1500   // tightened from 3000 in v0.3.2 — smaller prompt = faster LLM
const FLOW_MAX_TOKENS = 500
const DEFAULT_TIMEOUT_MS = 60_000        // raised from 15_000 in v0.3.2 — real-world LLM latency variance

function isEnabled(): boolean {
  const env = process.env['INTENT_FLOW_DIAGRAM']
  if (env == null) return true
  return env.toLowerCase() !== 'false' && env !== '0'
}

function getMaxNodes(): number {
  const env = process.env['INTENT_FLOW_MAX_NODES']
  if (!env) return DEFAULT_MAX_NODES
  const n = parseInt(env, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_NODES
}

function getFlowModel(): string {
  return process.env['AI_FLOW_MODEL'] ?? 'gpt-5.4-mini'
}

export function getTimeoutMs(): number {
  const env = process.env['INTENT_FLOW_TIMEOUT_MS']
  if (!env) return DEFAULT_TIMEOUT_MS
  const n = parseInt(env, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

// ---------------------------------------------------------------------------
// Sanitize — strip backticks/fences from user-supplied text so it can't
// break out of the prompt or leak fake mermaid blocks.
// ---------------------------------------------------------------------------

function sanitize(text: string): string {
  return text.replace(/```/g, "''' ").replace(/`/g, "'")
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildPrompt(input: FlowDiagramInput): { system: string; user: string } {
  const maxNodes = getMaxNodes()

  const system = [
    'You output ONLY a single Mermaid flowchart code block, nothing else.',
    'Wrap it in triple backticks with the `mermaid` language tag.',
    'Use `flowchart TD` (top-down). No prose, no explanation, no other diagram types.',
    'Use ONLY symbol names that appear in the provided IMPACT GRAPH or changed files.',
    'Highlight changed symbols using a `classDef changed fill:#fbb,stroke:#900` plus `class <symbol> changed`.',
    `Maximum ${maxNodes} nodes total.`,
  ].join('\n')

  // Concat IMPACT GRAPH excerpts under per-file headers, capped at budget.
  let impactText = ''
  for (const [file, section] of input.gitNexusSections) {
    if (impactText.length >= IMPACT_GRAPH_BUDGET_CHARS) break
    const remaining = IMPACT_GRAPH_BUDGET_CHARS - impactText.length
    const header = `\n--- ${file} ---\n`
    const piece = sanitize(section).slice(0, Math.max(0, remaining - header.length))
    impactText += header + piece
  }
  if (impactText.length > IMPACT_GRAPH_BUDGET_CHARS) {
    impactText = impactText.slice(0, IMPACT_GRAPH_BUDGET_CHARS) + '\n... [truncated]'
  }

  const fileBasenames = input.changedFiles.map((p) => p.split(/[/\\]/).pop() ?? p)
  const filesList = fileBasenames.length > 0
    ? fileBasenames.map((b) => `- ${b}`).join('\n')
    : '(none)'

  const bugLines = input.verifiedBugs.length > 0
    ? input.verifiedBugs
        .slice(0, 8)
        .map((b) => `- ${sanitize(b.file)}:${b.line} — ${sanitize(b.title)} (${sanitize(b.severity)})`)
        .join('\n')
    : '(none)'

  const user = [
    'Changed files in this PR:',
    filesList,
    '',
    'IMPACT GRAPH excerpts (truncated):',
    impactText || '(empty)',
    '',
    'Verified bugs (mark these locations on the diagram if helpful):',
    bugLines,
    '',
    'Generate the flowchart.',
  ].join('\n')

  return { system, user }
}

// ---------------------------------------------------------------------------
// Mermaid validation — minimal but strict enough to reject broken output.
// ---------------------------------------------------------------------------

const FENCE_OPEN = /```mermaid\s*\n/
const FENCE_CLOSE = /\n```\s*$/m

export function validateMermaid(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!FENCE_OPEN.test(trimmed)) return null
  if (!FENCE_CLOSE.test(trimmed)) return null

  // Extract body between the FIRST ```mermaid and the LAST ``` line.
  const openMatch = trimmed.match(/```mermaid\s*\n/)
  if (!openMatch) return null
  const bodyStart = openMatch.index! + openMatch[0].length
  const bodyEnd = trimmed.lastIndexOf('\n```')
  if (bodyEnd <= bodyStart) return null
  const body = trimmed.slice(bodyStart, bodyEnd)

  // Body must declare flowchart TD (anti-scope-creep: only this type).
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
  if (!/^flowchart\s+TD\b/.test(firstLine)) return null

  // Reject runaway diagrams.
  const totalLines = body.split('\n').length
  if (totalLines > getMaxNodes() + 10) return null

  // Reject inner backticks (could close the fence prematurely once embedded).
  if (body.includes('```')) return null

  // Return the canonical fenced block (stripped + re-fenced cleanly).
  return '```mermaid\n' + body.trim() + '\n```'
}

// ---------------------------------------------------------------------------
// Entry: synthesizeFlowDiagram
//
// `chatFn` is injectable for tests; production callers omit it.
// ---------------------------------------------------------------------------

export async function synthesizeFlowDiagram(
  input: FlowDiagramInput,
  chatFn: ChatFn = defaultChat,
): Promise<string> {
  if (!isEnabled()) return ''

  // Empty signal → nothing useful to draw.
  const hasGraph = input.gitNexusSections.size > 0
  const hasIntent = !!(input.intentSection && input.intentSection.length > 0)
  const hasBugs = input.verifiedBugs.length > 0
  const hasFiles = input.changedFiles.length > 0
  if (!hasGraph && !hasIntent && !hasBugs && !hasFiles) return ''

  const { system, user } = buildPrompt(input)
  const messages: Message[] = [{ role: 'user', content: user }]

  const flowModel = getFlowModel()
  const timeoutMs = getTimeoutMs()
  const promptBytes = system.length + user.length
  console.log(`[flow-diagram] start model=${flowModel} prompt=${promptBytes}b timeout=${timeoutMs}ms`)

  const prevModel = process.env['AI_MODEL']
  process.env['AI_MODEL'] = flowModel

  const start = Date.now()
  let response: string
  try {
    response = await chatFn(messages, {
      system,
      maxTokens: FLOW_MAX_TOKENS,
      timeoutMs,
    })
  } catch (err) {
    const elapsed = Date.now() - start
    console.warn(
      `[flow-diagram] chat failed after ${elapsed}ms:`,
      err instanceof Error ? err.message : String(err),
    )
    return ''
  } finally {
    if (prevModel === undefined) delete process.env['AI_MODEL']
    else process.env['AI_MODEL'] = prevModel
  }
  const elapsed = Date.now() - start
  console.log(`[flow-diagram] chat done elapsed=${elapsed}ms output=${response.length}b`)

  const validated = validateMermaid(response)
  if (!validated) {
    console.warn('[flow-diagram] LLM returned invalid Mermaid; skipping diagram')
    return ''
  }
  return validated
}
