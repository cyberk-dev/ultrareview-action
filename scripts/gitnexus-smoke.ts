// ---------------------------------------------------------------------------
// Smoke test for gitnexus-client.ts — run with: bun run scripts/gitnexus-smoke.ts
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
import { cypher, context, impact } from '../src/agent/gitnexus-typed-wrappers'

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

  console.log('\n=== Smoke test complete ===')
}

run().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
