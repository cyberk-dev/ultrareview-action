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
import { getChangedFiles, getHunkRanges } from '../src/agent/gitnexus-diff'

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

  console.log('\n=== Smoke test complete ===')
}

run().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
