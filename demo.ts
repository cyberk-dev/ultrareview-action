#!/usr/bin/env bun
/**
 * Non-interactive demo: test /review and /ultrareview flows directly
 * Usage: bun run demo.ts [review|ultrareview] [PR#]
 */
import { getPrDiff, getPrView, detectRepo } from './src/utils/git.ts'
import { chatStream } from './src/services/ai-client.ts'
import { REVIEW_SYSTEM_PROMPT } from './src/commands/review.ts'
import { checkOverageGate } from './src/commands/ultrareview/quota-gate.ts'
import { mockTeleport } from './src/commands/ultrareview/remote-launch.ts'
import { runBugHunterFleet } from './src/utils/mock-fleet.ts'

const mode = process.argv[2] || 'review'
const prNumber = process.argv[3] || '311'
const repo = process.argv[4] || 'cyberk-dev/skin-agent-app'

async function demoReview() {
  console.log(`\n=== /review ${prNumber} ===\n`)

  const repoInfo = await detectRepo()
  console.log('Repo:', repoInfo ? `${repoInfo.owner}/${repoInfo.name}` : `using --repo ${repo}`)

  console.log(`Fetching PR #${prNumber}...`)
  const view = await Bun.$`gh pr view ${prNumber} --repo ${repo}`.quiet().text().catch(() => 'N/A')
  const diff = await Bun.$`gh pr diff ${prNumber} --repo ${repo}`.quiet().text().catch(() => '')
  console.log(`PR view: ${view.slice(0, 200)}...`)
  console.log(`Diff: ${diff.length} chars\n`)

  const promptText = `Review this PR:\n\n## PR Details\n${view}\n\n## Diff\n${diff.slice(0, 30000)}`

  console.log('Streaming AI review...\n')
  for await (const token of chatStream(
    [{ role: 'user', content: promptText }],
    { system: REVIEW_SYSTEM_PROMPT },
  )) {
    process.stdout.write(token)
  }
  console.log('\n\n=== Done ===')
}

async function demoUltrareview() {
  console.log(`\n=== /ultrareview ${prNumber} ===\n`)

  // 1. Quota gate
  const gate = await checkOverageGate()
  console.log('Quota gate:', gate.kind)

  // 2. Mock teleport
  console.log('Teleporting...')
  const session = await mockTeleport(prNumber)
  console.log(`Session: ${session.id}`)
  console.log(`URL: ${session.url}\n`)

  // 3. Get real diff
  console.log('Fetching PR diff...')
  const diff = await Bun.$`gh pr diff ${prNumber} --repo ${repo}`.quiet().text().catch(() => '')
  const view = await Bun.$`gh pr view ${prNumber} --repo ${repo}`.quiet().text().catch(() => '')
  console.log(`Diff: ${diff.length} chars\n`)

  // 4. Run BugHunter fleet
  console.log('Running BugHunter fleet (3 agents in parallel)...\n')
  const result = await runBugHunterFleet(diff.slice(0, 30000), view.slice(0, 2000))

  console.log(`Fleet completed in ${result.duration}ms`)
  console.log(`Found ${result.bugs.length} bugs:\n`)

  for (const bug of result.bugs) {
    const icon = bug.severity === 'critical' ? '🔴' : bug.severity === 'high' ? '🟠' : bug.severity === 'medium' ? '🟡' : '⚪'
    const status = bug.verified ? '✓ verified' : '✗ refuted'
    console.log(`${icon} [${bug.severity.toUpperCase()}] ${bug.title} (${status})`)
    console.log(`   File: ${bug.file}${bug.line ? `:${bug.line}` : ''}`)
    console.log(`   ${bug.description}`)
    console.log(`   Suggestion: ${bug.suggestion}\n`)
  }

  console.log('=== Done ===')
}

if (mode === 'ultrareview') {
  await demoUltrareview()
} else {
  await demoReview()
}
