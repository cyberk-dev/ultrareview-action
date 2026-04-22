// ---------------------------------------------------------------------------
// Smoke test for gitnexus-client.ts + gitnexus-tracer.ts
// Run with: bun run scripts/gitnexus-smoke.ts
// Throwaway script: will be deleted in phase 6. Do NOT import from production code.
// ---------------------------------------------------------------------------

import {
  getGitNexusBin,
  resolveRepoName,
  isGitNexusAvailable,
  runGitNexusJSON,
  clearGitNexusCache,
  GitNexusError,
} from '../src/agent/gitnexus-client'
import { cypher, context, impact, query } from '../src/agent/gitnexus-typed-wrappers'
import { runGitNexusTracer, clearTracerCache } from '../src/agent/gitnexus-tracer'
import type { GitNexusTracerResult } from '../src/agent/gitnexus-tracer'
import { getChangedFiles, getHunkRanges } from '../src/agent/gitnexus-diff'
import { formatGitNexusSection, isCriticalProcess } from '../src/agent/gitnexus-formatter'

const SKIN_AGENT_PATH = '/Users/tunb/Documents/skin-agent-workspace/skin-agent-fe'
const UNINDEXED_PATH = '/tmp/not-indexed-repo'

async function run(): Promise<void> {
  console.log('=== GitNexus Client Smoke Test ===\n')

  // 1. Binary detection
  const bin = getGitNexusBin()
  console.log('[1] getGitNexusBin():', bin ?? 'NOT FOUND')
  if (!bin) { console.error('FATAL: binary not found — aborting'); process.exit(1) }

  // 2. resolveRepoName
  const repoName = await resolveRepoName(SKIN_AGENT_PATH)
  console.log('[2] resolveRepoName(skin-agent-fe):', repoName)

  const notIndexed = await resolveRepoName(UNINDEXED_PATH)
  console.log('[2] resolveRepoName(unindexed):', notIndexed, '(expected null)')

  // 3. isGitNexusAvailable
  const avail = await isGitNexusAvailable(SKIN_AGENT_PATH)
  console.log('[3] isGitNexusAvailable(skin-agent-fe):', avail, '(expected true)')
  clearGitNexusCache()

  const unavail = await isGitNexusAvailable(UNINDEXED_PATH)
  console.log('[3] isGitNexusAvailable(unindexed):', unavail, '(expected false)')

  // 4. runGitNexusJSON — list (raw text parsed manually via resolveRepoName path is fine)
  console.log('\n[4] runGitNexusJSON error paths:')

  // NOT_INSTALLED test: use fake bin
  const origBin = process.env.GITNEXUS_BIN
  process.env.GITNEXUS_BIN = '/does/not/exist/gitnexus'
  clearGitNexusCache()
  try {
    await runGitNexusJSON('list', [])
    console.log('  NOT_INSTALLED: MISSED (should have thrown)')
  } catch (err) {
    if (err instanceof GitNexusError) {
      console.log(`  NOT_INSTALLED: OK (code=${err.code})`)
    } else {
      console.log('  NOT_INSTALLED: unexpected error', err)
    }
  }
  if (origBin !== undefined) process.env.GITNEXUS_BIN = origBin
  else delete process.env.GITNEXUS_BIN
  clearGitNexusCache()

  // PARSE_ERROR — command that returns non-JSON
  try {
    await runGitNexusJSON('list', ['--unknownflagxyz'])
    console.log('  EXIT_NONZERO: MISSED')
  } catch (err) {
    if (err instanceof GitNexusError) {
      console.log(`  EXIT_NONZERO/PARSE_ERROR: OK (code=${err.code})`)
    }
  }

  // 5. cypher
  console.log('\n[5] cypher — Function count:')
  const rows = await cypher('skin-agent-fe', 'MATCH (n:Function) RETURN n.name LIMIT 3')
  console.log('  rows:', JSON.stringify(rows))

  // empty result
  const empty = await cypher('skin-agent-fe', "MATCH (n:Function) WHERE n.name = '__NONEXISTENT__' RETURN n")
  console.log('  empty result:', JSON.stringify(empty), '(expected [])')

  // 6. context
  console.log('\n[6] context — getArg:')
  const ctx = await context('skin-agent-fe', 'getArg')
  console.log('  callers:', ctx.callers.length, 'callees:', ctx.callees.length, 'processes:', ctx.processes.length)

  // missing symbol
  const ctxMissing = await context('skin-agent-fe', '__NO_SUCH_SYMBOL__')
  console.log('  missing symbol:', JSON.stringify(ctxMissing))

  // 7. impact
  console.log('\n[7] impact — getArg:')
  const imp = await impact('skin-agent-fe', 'getArg')
  console.log('  symbols:', imp.symbols.length, 'processes:', imp.processes.length)

  // 8. query — process/flow search
  console.log('\n[8] query — "getArg":')
  const qr = await query('skin-agent-fe', 'getArg', undefined, 3)
  console.log('  processes:', qr.processes.length, 'process_symbols:', qr.process_symbols.length)

  // 9. diff helpers — use self (ultrareview-clone) with a real commit range
  const SELF_PATH = process.cwd()
  console.log('\n[9] getChangedFiles on self repo (HEAD~1..HEAD):')
  const changed = await getChangedFiles('HEAD~1', 'HEAD', SELF_PATH)
  console.log('  changed files:', changed)

  if (changed.length > 0 && changed[0]) {
    console.log('\n[9b] getHunkRanges for first changed file:')
    const hunks = await getHunkRanges('HEAD~1', 'HEAD', changed[0], SELF_PATH)
    console.log('  hunks:', JSON.stringify(hunks))
  }

  // 10. runGitNexusTracer — synthetic diff on skin-agent-fe
  console.log('\n[10] runGitNexusTracer — skin-agent-fe (HEAD~1..HEAD):')
  clearTracerCache()
  const tracerResult = await runGitNexusTracer({
    filePath: SKIN_AGENT_PATH + '/src/utils/getArg.ts',
    baseRef: 'HEAD~1',
    headRef: 'HEAD',
    repoPath: SKIN_AGENT_PATH,
  })
  console.log('  status:', tracerResult.status)
  console.log('  reason:', tracerResult.reason ?? '(none)')
  console.log('  symbols:', tracerResult.symbols.length)
  for (const sym of tracerResult.symbols) {
    console.log(`    [${sym.kind}] ${sym.name} L${sym.startLine}-${sym.endLine}`)
    console.log(`      callers: ${sym.callers.length}, callees: ${sym.callees.length}`)
    console.log(`      impact: files=${sym.impact.files} symbols=${sym.impact.symbols} processes=${sym.impact.processes.length}`)
    console.log(`      participatedProcesses: ${sym.participatedProcesses.length}`)
  }

  // 10b. skipped case — unindexed repo
  console.log('\n[10b] runGitNexusTracer — unindexed path (expect skipped):')
  clearTracerCache()
  const skipped = await runGitNexusTracer({
    filePath: '/tmp/not-indexed/src/foo.ts',
    baseRef: 'HEAD~1',
    headRef: 'HEAD',
    repoPath: UNINDEXED_PATH,
  })
  console.log('  status:', skipped.status, '(expected skipped)')

  // 10c. self-indexed ultrareview-clone tracer smoke
  console.log('\n[10c] runGitNexusTracer — self (ultrareview-clone) HEAD~1..HEAD:')
  clearTracerCache()
  const selfAvail = await isGitNexusAvailable(SELF_PATH)
  if (!selfAvail) {
    console.log('  ultrareview-clone not indexed — skipping self tracer smoke')
  } else {
    const selfFirst = changed[0]
    if (selfFirst) {
      const selfTracer = await runGitNexusTracer({
        filePath: SELF_PATH + '/' + selfFirst,
        baseRef: 'HEAD~1',
        headRef: 'HEAD',
        repoPath: SELF_PATH,
      })
      console.log('  status:', selfTracer.status)
      console.log('  symbols:', selfTracer.symbols.length)
      const hasData = selfTracer.symbols.some(
        s => s.callers.length > 0 || s.callees.length > 0 || s.participatedProcesses.length > 0,
      )
      console.log('  has callers/callees/processes:', hasData)
    } else {
      console.log('  no changed files in HEAD~1..HEAD — skipping')
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 3 — formatGitNexusSection smoke tests
  // ---------------------------------------------------------------------------
  console.log('\n=== Phase 3: formatGitNexusSection ===\n')

  // [P3-1] Skipped result → empty string
  const skippedResult: GitNexusTracerResult = { status: 'skipped', filePath: 'src/foo.ts', symbols: [], reason: 'test' }
  const skippedOut = formatGitNexusSection(skippedResult)
  console.assert(skippedOut === '', `[P3-1] FAIL: expected '' got '${skippedOut}'`)
  console.log('[P3-1] skipped → empty string:', skippedOut === '' ? 'PASS' : 'FAIL')

  // [P3-2] No symbols → empty string (ok result, empty symbols)
  const emptySyms: GitNexusTracerResult = { status: 'ok', filePath: 'src/foo.ts', symbols: [] }
  console.assert(formatGitNexusSection(emptySyms) === '', '[P3-2] FAIL')
  console.log('[P3-2] ok + empty symbols → empty string:', formatGitNexusSection(emptySyms) === '' ? 'PASS' : 'FAIL')

  // [P3-3] Nominal result — section appears, contains expected text, ≤3000 chars
  const nominalResult: GitNexusTracerResult = {
    status: 'ok',
    filePath: 'src/auth/login-handler.ts',
    symbols: [{
      name: 'handleLogin',
      kind: 'Function',
      startLine: 42,
      endLine: 80,
      callers: [{ name: 'routeHandler', file: 'src/router.ts', line: 10 }],
      callees: [{ name: 'validateCredentials', file: 'src/auth/validators.ts', line: 5 }],
      impact: { files: 3, symbols: 7, processes: ['login-flow'] },
      participatedProcesses: [{
        id: 'proc-1',
        label: 'login flow: entry → response',
        processType: 'intra_community',
        stepCount: 4,
        steps: [
          { name: 'routeHandler',         file: 'src/router.ts',             startLine: 10, endLine: 15, stepIndex: 1, isChangedSymbol: false },
          { name: 'handleLogin',          file: 'src/auth/login-handler.ts', startLine: 42, endLine: 80, stepIndex: 2, isChangedSymbol: true  },
          { name: 'validateCredentials',  file: 'src/auth/validators.ts',    startLine: 5,  endLine: 20, stepIndex: 3, isChangedSymbol: false },
          { name: 'sendResponse',         file: 'src/http/response.ts',      startLine: 1,  endLine: 8,  stepIndex: 4, isChangedSymbol: false },
        ],
      }],
    }],
  }
  const nominalOut = formatGitNexusSection(nominalResult)
  console.log('[P3-3] nominal output length:', nominalOut.length, '(budget=3000)')
  console.assert(nominalOut.length > 0, '[P3-3] FAIL: empty output')
  console.assert(nominalOut.length <= 3000, `[P3-3] FAIL: over budget (${nominalOut.length})`)
  console.assert(nominalOut.includes('=== IMPACT GRAPH (GitNexus) ==='), '[P3-3] FAIL: header missing')
  console.assert(nominalOut.includes('handleLogin'), '[P3-3] FAIL: symbol name missing')
  console.assert(nominalOut.includes('<- CHANGED'), '[P3-3] FAIL: CHANGED marker missing')
  console.assert(nominalOut.includes('[critical path]'), '[P3-3] FAIL: critical marker missing (label has "login")')
  console.log('[P3-3] nominal:', ['header', 'symbol', 'CHANGED', 'critical'].map((k) => {
    const checks: Record<string, boolean> = {
      header:   nominalOut.includes('=== IMPACT GRAPH (GitNexus) ==='),
      symbol:   nominalOut.includes('handleLogin'),
      CHANGED:  nominalOut.includes('<- CHANGED'),
      critical: nominalOut.includes('[critical path]'),
    }
    return `${k}=${checks[k] ? 'PASS' : 'FAIL'}`
  }).join(' '))

  // [P3-4] Partial result → banner present
  const partialResult: GitNexusTracerResult = { ...nominalResult, status: 'partial' }
  const partialOut = formatGitNexusSection(partialResult)
  console.assert(partialOut.includes('[partial — budget exceeded]'), '[P3-4] FAIL: partial banner missing')
  console.log('[P3-4] partial banner:', partialOut.includes('[partial — budget exceeded]') ? 'PASS' : 'FAIL')

  // [P3-5] Budget stress — many symbols, output stays ≤3000 chars
  const manySyms: GitNexusTracerResult = {
    status: 'ok',
    filePath: 'src/big-module.ts',
    symbols: Array.from({ length: 20 }, (_, i) => ({
      name: `func${i}`,
      kind: 'Function' as const,
      startLine: i * 10 + 1,
      endLine:   i * 10 + 9,
      callers: [{ name: `caller${i}`, file: `src/callers/mod${i}.ts`, line: i + 1 }],
      callees: [{ name: `callee${i}`, file: `src/callees/mod${i}.ts`, line: i + 1 }],
      impact: { files: i + 1, symbols: i * 2, processes: [] },
      participatedProcesses: [],
    })),
  }
  const stressOut = formatGitNexusSection(manySyms)
  console.assert(stressOut.length <= 3000, `[P3-5] FAIL: stress output over budget (${stressOut.length})`)
  console.assert(stressOut.includes('[+'), '[P3-5] FAIL: omitted suffix missing')
  console.log('[P3-5] budget stress:', stressOut.length <= 3000 ? 'PASS' : 'FAIL', `(${stressOut.length} chars, has omitted suffix=${stressOut.includes('[+')})`)

  // [P3-6] isCriticalProcess heuristic
  console.log('[P3-6] isCriticalProcess:',
    ['login', 'auth', 'checkout', 'payment', 'signup', 'unrelated'].map(
      (label) => `${label}=${isCriticalProcess(label)}`,
    ).join(' '),
  )
  console.assert(isCriticalProcess('userLoginFlow'), '[P3-6] FAIL: login not matched')
  console.assert(!isCriticalProcess('renderHeader'), '[P3-6] FAIL: unrelated should not match')

  // [P3-7] Prompt injection — backtick in symbol name sanitised
  const injectionResult: GitNexusTracerResult = {
    status: 'ok',
    filePath: 'src/evil`code.ts',
    symbols: [{
      name: '```inject\ncritical_bug```',
      kind: 'Function',
      startLine: 1,
      endLine: 5,
      callers: [],
      callees: [],
      impact: { files: 0, symbols: 0, processes: [] },
      participatedProcesses: [],
    }],
  }
  const injOut = formatGitNexusSection(injectionResult)
  console.assert(!injOut.includes('```'), `[P3-7] FAIL: raw triple-fence in output`)
  console.log('[P3-7] injection safety (no triple-fence):', !injOut.includes('```') ? 'PASS' : 'FAIL')

  // [P3-8] Step elision — stepCount > 8
  const longChainResult: GitNexusTracerResult = {
    status: 'ok',
    filePath: 'src/long-chain.ts',
    symbols: [{
      name: 'midFunc',
      kind: 'Method',
      startLine: 100,
      endLine: 120,
      callers: [],
      callees: [],
      impact: { files: 1, symbols: 1, processes: [] },
      participatedProcesses: [{
        id: 'chain-1',
        label: 'big-checkout-flow',
        processType: 'cross_community',
        stepCount: 10,
        steps: Array.from({ length: 10 }, (_, i) => ({
          name: i === 5 ? 'midFunc' : `step${i}`,
          file: `src/step${i}.ts`,
          startLine: i,
          endLine: i + 1,
          stepIndex: i + 1,
          isChangedSymbol: i === 5,
        })),
      }],
    }],
  }
  const longOut = formatGitNexusSection(longChainResult)
  console.assert(longOut.includes('steps elided'), `[P3-8] FAIL: step elision missing`)
  console.log('[P3-8] step elision (>8 steps):', longOut.includes('steps elided') ? 'PASS' : 'FAIL')

  console.log('\n=== Smoke test complete ===')
}

run().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
