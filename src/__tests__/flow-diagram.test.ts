import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import {
  buildPrompt,
  synthesizeFlowDiagram,
  validateMermaid,
  type FlowDiagramInput,
} from '../agent/flow-diagram'

const MIN_INPUT: FlowDiagramInput = {
  changedFiles: ['src/auth/login.ts'],
  gitNexusSections: new Map([
    ['src/auth/login.ts', '## IMPACT\nhandleLogin -> validatePassword'],
  ]),
  intentSection: undefined,
  verifiedBugs: [],
}

const VALID_MERMAID = [
  '```mermaid',
  'flowchart TD',
  '    A[handleLogin] --> B[validatePassword]',
  '    B --> C[bcryptCompare]',
  '    classDef changed fill:#fbb,stroke:#900',
  '    class B changed',
  '```',
].join('\n')

// ---------------------------------------------------------------------------
// validateMermaid
// ---------------------------------------------------------------------------

describe('validateMermaid', () => {
  test('valid flowchart TD block → returns canonical block', () => {
    const out = validateMermaid(VALID_MERMAID)
    expect(out).not.toBeNull()
    expect(out!.startsWith('```mermaid')).toBe(true)
    expect(out!.endsWith('```')).toBe(true)
    expect(out).toContain('flowchart TD')
  })

  test('rejects sequenceDiagram (anti-scope-creep)', () => {
    const seq = '```mermaid\nsequenceDiagram\nA->>B: hi\n```'
    expect(validateMermaid(seq)).toBeNull()
  })

  test('rejects missing closing fence', () => {
    const broken = '```mermaid\nflowchart TD\n    A --> B\n'
    expect(validateMermaid(broken)).toBeNull()
  })

  test('rejects no fence at all', () => {
    const plain = 'flowchart TD\n    A --> B'
    expect(validateMermaid(plain)).toBeNull()
  })

  test('rejects empty input', () => {
    expect(validateMermaid('')).toBeNull()
  })

  test('rejects when body exceeds line cap (default 20)', () => {
    const lines = ['flowchart TD']
    for (let i = 0; i < 40; i++) lines.push(`    A${i} --> A${i + 1}`)
    const huge = '```mermaid\n' + lines.join('\n') + '\n```'
    expect(validateMermaid(huge)).toBeNull()
  })

  test('rejects inner triple backticks (would close fence prematurely)', () => {
    const tricky = '```mermaid\nflowchart TD\n    A[evil] ```\n    B --> C\n```'
    expect(validateMermaid(tricky)).toBeNull()
  })

  test('allows single backticks inside node labels (common in Mermaid)', () => {
    const ok = '```mermaid\nflowchart TD\n    A[fn `name`] --> B\n```'
    expect(validateMermaid(ok)).not.toBeNull()
  })

  test('returns canonical re-fenced block (strips leading/trailing whitespace)', () => {
    const padded = '\n\n  ```mermaid\nflowchart TD\n    A --> B\n```  \n\n'
    const out = validateMermaid(padded)
    expect(out).not.toBeNull()
    expect(out).toBe('```mermaid\nflowchart TD\n    A --> B\n```')
  })
})

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  test('includes changed file basenames', () => {
    const { user } = buildPrompt(MIN_INPUT)
    expect(user).toContain('login.ts')
    expect(user).toContain('IMPACT GRAPH excerpts')
    expect(user).toContain('handleLogin')
  })

  test('includes verified bugs section when present', () => {
    const { user } = buildPrompt({
      ...MIN_INPUT,
      verifiedBugs: [{ file: 'a.ts', line: 10, title: 'null deref', severity: 'high' }],
    })
    expect(user).toContain('a.ts:10')
    expect(user).toContain('null deref')
    expect(user).toContain('(high)')
  })

  test('marks bugs as (none) when empty', () => {
    const { user } = buildPrompt(MIN_INPUT)
    expect(user).toMatch(/Verified bugs.*\n\(none\)/s)
  })

  test('truncates IMPACT GRAPH to 3K char budget', () => {
    const huge = 'X'.repeat(10_000)
    const { user } = buildPrompt({
      ...MIN_INPUT,
      gitNexusSections: new Map([['big.ts', huge]]),
    })
    expect(user.length).toBeLessThan(5_000)
    expect(user).toContain('truncated')
  })

  test('system prompt enforces flowchart TD only + max nodes', () => {
    const { system } = buildPrompt(MIN_INPUT)
    expect(system).toContain('flowchart TD')
    expect(system).toContain('Maximum 10 nodes')
    expect(system).toContain('Mermaid')
  })
})

// ---------------------------------------------------------------------------
// synthesizeFlowDiagram (orchestrator) — uses injected chatFn for determinism
// ---------------------------------------------------------------------------

describe('synthesizeFlowDiagram — graceful skip + happy path', () => {
  let prevEnabled: string | undefined
  let prevModel: string | undefined

  beforeEach(() => {
    prevEnabled = process.env['INTENT_FLOW_DIAGRAM']
    prevModel = process.env['AI_FLOW_MODEL']
  })

  afterEach(() => {
    if (prevEnabled == null) delete process.env['INTENT_FLOW_DIAGRAM']
    else process.env['INTENT_FLOW_DIAGRAM'] = prevEnabled
    if (prevModel == null) delete process.env['AI_FLOW_MODEL']
    else process.env['AI_FLOW_MODEL'] = prevModel
  })

  test('INTENT_FLOW_DIAGRAM=false → returns "" without calling chat', async () => {
    process.env['INTENT_FLOW_DIAGRAM'] = 'false'
    let called = false
    const stub = async () => { called = true; return VALID_MERMAID }
    const out = await synthesizeFlowDiagram(MIN_INPUT, stub)
    expect(out).toBe('')
    expect(called).toBe(false)
  })

  test('all inputs empty → returns "" without calling chat', async () => {
    let called = false
    const stub = async () => { called = true; return VALID_MERMAID }
    const out = await synthesizeFlowDiagram({
      changedFiles: [],
      gitNexusSections: new Map(),
      intentSection: undefined,
      verifiedBugs: [],
    }, stub)
    expect(out).toBe('')
    expect(called).toBe(false)
  })

  test('chat throws → returns "" (graceful skip, no rethrow)', async () => {
    const stub = async () => { throw new Error('network failed') }
    const out = await synthesizeFlowDiagram(MIN_INPUT, stub)
    expect(out).toBe('')
  })

  test('chat returns invalid Mermaid → returns "" (validation rejects)', async () => {
    const stub = async () => 'not a mermaid block, just plain text'
    const out = await synthesizeFlowDiagram(MIN_INPUT, stub)
    expect(out).toBe('')
  })

  test('chat returns valid Mermaid → returns canonical block', async () => {
    const stub = async () => VALID_MERMAID
    const out = await synthesizeFlowDiagram(MIN_INPUT, stub)
    expect(out).not.toBe('')
    expect(out).toContain('flowchart TD')
    expect(out.startsWith('```mermaid')).toBe(true)
  })

  test('honors AI_FLOW_MODEL env override during chat', async () => {
    process.env['AI_FLOW_MODEL'] = 'kimi-k2.5'
    let modelSeen = ''
    const stub = async () => {
      modelSeen = process.env['AI_MODEL'] ?? ''
      return VALID_MERMAID
    }
    await synthesizeFlowDiagram(MIN_INPUT, stub)
    expect(modelSeen).toBe('kimi-k2.5')
    // After call, AI_MODEL must be restored (was undefined or prior value)
  })
})
