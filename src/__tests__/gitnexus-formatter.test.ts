import { test, expect, describe } from 'bun:test'
import { formatGitNexusSection, isCriticalProcess } from '../agent/gitnexus-formatter'
import type { GitNexusTracerResult, TracedSymbol } from '../agent/gitnexus-tracer'

describe('gitnexus-formatter', () => {
  const makeSymbol = (overrides?: Partial<TracedSymbol>): TracedSymbol => ({
    name: 'testFunc',
    kind: 'function',
    file: 'src/test.ts',
    startLine: 10,
    endLine: 20,
    callers: [],
    callees: [],
    impact: { files: 1, symbols: 1 },
    participatedProcesses: [],
    routeImpact: [],
    shapeDrift: [],
    ...overrides,
  })

  const makeResult = (overrides?: Partial<GitNexusTracerResult>): GitNexusTracerResult => ({
    status: 'ok',
    filePath: 'src/test.ts',
    symbols: [],
    tracedAt: new Date().toISOString(),
    ...overrides,
  })

  test('formatGitNexusSection returns empty string for skipped status', () => {
    const result = makeResult({ status: 'skipped' })
    const output = formatGitNexusSection(result)
    expect(output).toBe('')
  })

  test('formatGitNexusSection returns empty string for empty symbols', () => {
    const result = makeResult({ status: 'ok', symbols: [] })
    const output = formatGitNexusSection(result)
    expect(output).toBe('')
  })

  test('formatGitNexusSection returns banner for partial status', () => {
    const result = makeResult({
      status: 'partial',
      symbols: [makeSymbol({ name: 'testFunc' })],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('[partial — budget exceeded]')
    expect(output).toContain('=== IMPACT GRAPH')
    expect(output).toContain('testFunc')
  })

  test('formatGitNexusSection includes header and footer', () => {
    const result = makeResult({
      symbols: [makeSymbol()],
      filePath: 'src/app.ts',
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('=== IMPACT GRAPH (GitNexus) ===')
    expect(output).toContain('File: src/app.ts')
    expect(output).toContain('===')
    expect(output).toContain('Dynamic dispatch')
  })

  test('formatGitNexusSection includes symbol info', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({
          name: 'getUser',
          file: 'src/api.ts',
          startLine: 50,
          endLine: 75,
          callers: [
            { name: 'handler', file: 'src/route.ts', line: 100 },
          ],
        }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('getUser')
    expect(output).toContain('(function)')
    expect(output).toContain('lines 50-75')
    expect(output).toContain('handler')
    expect(output).toContain('Callers (1)')
  })

  test('formatGitNexusSection sanitizes backticks in symbol names', () => {
    const result = makeResult({
      symbols: [makeSymbol({ name: 'func`with`backticks' })],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('func\'with\'backticks')
    expect(output).not.toContain('`')
  })

  test('formatGitNexusSection sanitizes code fences in caller paths', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({
          callers: [{ name: 'func', file: 'src///weird///path.ts', line: 10 }],
        }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('src//weird//path.ts')
  })

  test('formatGitNexusSection truncates over budget with +N suffix', () => {
    // Create many symbols to exceed budget
    const symbols = Array.from({ length: 50 }, (_, i) =>
      makeSymbol({
        name: `symbol${i}`,
        callers: Array.from({ length: 10 }, (_, j) => ({
          name: `caller${j}`,
          file: `src/file${j}.ts`,
          line: 100 + j,
        })),
        participatedProcesses: [
          {
            label: `process${i}`,
            processType: 'flow',
            steps: Array.from({ length: 20 }, (_, k) => ({
              name: `step${k}`,
              file: `src/f.ts`,
              startLine: k,
              isChangedSymbol: k === 0,
            })),
            stepCount: 20,
          },
        ],
      })
    )
    const result = makeResult({ symbols })
    const output = formatGitNexusSection(result)
    expect(output).toContain('[+')
    expect(output).toContain('more symbols omitted]')
  })

  test('isCriticalProcess matches login keyword', () => {
    expect(isCriticalProcess('login')).toBe(true)
    expect(isCriticalProcess('user login flow')).toBe(true)
    expect(isCriticalProcess('handleLogin')).toBe(true)
  })

  test('isCriticalProcess matches auth keyword', () => {
    expect(isCriticalProcess('auth')).toBe(true)
    expect(isCriticalProcess('authentication')).toBe(true)
    expect(isCriticalProcess('checkAuth')).toBe(true)
  })

  test('isCriticalProcess matches payment keyword', () => {
    expect(isCriticalProcess('payment')).toBe(true)
    expect(isCriticalProcess('processPayment')).toBe(true)
  })

  test('isCriticalProcess matches checkout keyword', () => {
    expect(isCriticalProcess('checkout')).toBe(true)
  })

  test('isCriticalProcess is case-insensitive', () => {
    expect(isCriticalProcess('LOGIN')).toBe(true)
    expect(isCriticalProcess('Auth')).toBe(true)
    expect(isCriticalProcess('PAYMENT')).toBe(true)
  })

  test('isCriticalProcess returns false for non-critical', () => {
    expect(isCriticalProcess('helper')).toBe(false)
    expect(isCriticalProcess('getData')).toBe(false)
    expect(isCriticalProcess('normalFlow')).toBe(false)
  })

  test('formatGitNexusSection marks critical process in output', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({
          participatedProcesses: [
            {
              label: 'user login',
              processType: 'flow',
              steps: [
                { name: 'validateCreds', file: 'src/auth.ts', startLine: 10, isChangedSymbol: true },
              ],
              stepCount: 1,
            },
          ],
        }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('[critical path]')
  })

  test('formatGitNexusSection shows changed symbol marker', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({
          name: 'myFunc',
          callers: [{ name: 'myFunc', file: 'src/test.ts', line: 5 }],
          participatedProcesses: [
            {
              label: 'flow1',
              processType: 'call',
              steps: [
                { name: 'myFunc', file: 'src/test.ts', startLine: 10, isChangedSymbol: true },
              ],
              stepCount: 1,
            },
          ],
        }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('<- CHANGED')
  })

  test('formatGitNexusSection elides long process steps', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({
          participatedProcesses: [
            {
              label: 'longProcess',
              processType: 'flow',
              steps: Array.from({ length: 15 }, (_, i) => ({
                name: `step${i}`,
                file: 'src/test.ts',
                startLine: i,
                isChangedSymbol: false,
              })),
              stepCount: 15,
            },
          ],
        }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('... ')
    expect(output).toContain('steps elided')
  })

  test('formatGitNexusSection includes route impact lines', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({
          routeImpact: [
            { method: 'POST', path: '/api/users' },
            { method: 'GET', path: '/api/users/{id}' },
          ],
        }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('Route: POST /api/users')
    expect(output).toContain('Route: GET /api/users/{id}')
  })

  test('formatGitNexusSection includes shape drift lines', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({
          shapeDrift: [
            { kind: 'add', field: 'newField', note: 'added in v2' },
            { kind: 'remove', field: 'oldField', note: 'deprecated' },
          ],
        }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain("+field 'newField'")
    expect(output).toContain("-field 'oldField'")
  })

  test('formatGitNexusSection counts changed symbols correctly', () => {
    const result = makeResult({
      symbols: [
        makeSymbol({ name: 'func1' }),
        makeSymbol({ name: 'func2' }),
        makeSymbol({ name: 'func3' }),
      ],
    })
    const output = formatGitNexusSection(result)
    expect(output).toContain('Changed symbols: 3')
  })
})
