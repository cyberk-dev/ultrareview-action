// ---------------------------------------------------------------------------
// Non-interactive mode: run a slash command, print to stdout, exit
// No Ink/TTY required — works in pipes, CI, sandboxed shells
// ---------------------------------------------------------------------------

import { getCommands, parseSlashCommand } from './commands/commands.ts'
import { chatStream } from './services/ai-client.ts'
import { REVIEW_SYSTEM_PROMPT } from './commands/review.ts'
import { checkOverageGate } from './commands/ultrareview/quota-gate.ts'
import { mockTeleport, gatherReviewContext } from './commands/ultrareview/remote-launch.ts'
import { runAgentLoop } from './agent/agent-loop.ts'
import { postPrReview } from './github/pr-comments.ts'
import type { FleetResult } from './utils/mock-fleet.ts'

export type NonInteractiveOptions = {
  github?: boolean
}

export async function runNonInteractive(input: string, opts: NonInteractiveOptions = {}): Promise<void> {
  const parsed = parseSlashCommand(input)
  if (!parsed) {
    console.error(`Not a slash command: "${input}"`)
    process.exit(1)
  }

  const commands = getCommands()
  const cmd = commands.find(c => c.name === parsed.name || c.aliases?.includes(parsed.name))
  if (!cmd) {
    console.error(`Unknown command: /${parsed.name}`)
    console.error(`Available: ${commands.map(c => `/${c.name}`).join(', ')}`)
    process.exit(1)
  }

  if (cmd.type === 'prompt') {
    await handlePromptCommand(cmd, parsed.args)
  } else if (cmd.type === 'local-jsx' && cmd.name === 'ultrareview') {
    await handleUltrareview(parsed.args, opts)
  } else {
    console.error(`Command /${cmd.name} requires interactive mode (no --print flag)`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// /review — fetch diff, stream AI review to stdout
// ---------------------------------------------------------------------------
async function handlePromptCommand(
  cmd: { getPromptForCommand(args: string): Promise<string> },
  args: string,
): Promise<void> {
  const promptText = await cmd.getPromptForCommand(args)

  if (!args.trim()) {
    // No PR# — just print PR list
    console.log(promptText)
    return
  }

  console.log('Streaming AI review...\n')
  for await (const token of chatStream(
    [{ role: 'user', content: promptText }],
    { system: REVIEW_SYSTEM_PROMPT },
  )) {
    process.stdout.write(token)
  }
  console.log()
}

// ---------------------------------------------------------------------------
// /ultrareview — quota gate, mock teleport, polling, fleet
// ---------------------------------------------------------------------------
async function handleUltrareview(args: string, opts: NonInteractiveOptions = {}): Promise<void> {
  // 1. Quota gate
  const gate = await checkOverageGate()
  if (gate.kind === 'not-enabled') {
    console.error('Free ultrareviews used. Enable Extra Usage to continue.')
    process.exit(1)
  }
  if (gate.kind === 'low-balance') {
    console.error(`Balance too low ($${gate.available.toFixed(2)}, $10 minimum).`)
    process.exit(1)
  }
  if (gate.kind === 'needs-confirm') {
    console.log('Note: This review would bill as Extra Usage (auto-confirmed in --print mode).')
  }
  if (gate.kind === 'proceed' && gate.billingNote) {
    console.log(gate.billingNote.trim())
  }

  // 2. Gather context
  console.log('Gathering review context...')
  const context = await gatherReviewContext(args)
  if (!context.diff.trim()) {
    console.error('Empty diff — nothing to review.')
    process.exit(1)
  }
  console.log(`Diff: ${context.diff.length} chars`)

  // 3. Mock teleport
  console.log('Teleporting...')
  const session = await mockTeleport(args)
  console.log(`Session: ${session.id}`)
  console.log(`URL: ${session.url}\n`)

  // 4. Run agent loop pipeline directly (no mock polling for --print mode)
  console.log('Running agent loop pipeline...')
  const repoRoot = process.cwd()
  const result: FleetResult = await runAgentLoop(
    context.diff,
    repoRoot,
    (step, detail) => {
      process.stdout.write(`\r  [${step}] ${detail}                    `)
    },
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\nAgent loop error: ${msg}`)
    return { bugs: [], duration: 0 }
  })

  console.log(`\n\nPipeline completed in ${result.duration}ms`)
  console.log(`Found ${result.bugs.length} bugs:\n`)
  for (const bug of result.bugs) {
    const severityLabel = bug.severity === 'critical' ? '[CRITICAL]' : bug.severity === 'high' ? '[HIGH]' : bug.severity === 'medium' ? '[MEDIUM]' : '[LOW]'
    const status = bug.verified ? 'verified' : 'unverified'
    console.log(`${severityLabel} ${bug.title} (${status})`)
    console.log(`   File: ${bug.file}${bug.line ? `:${bug.line}` : ''}`)
    console.log(`   ${bug.description}`)
    console.log(`   Suggestion: ${bug.suggestion}\n`)
  }

  // 5. Post to GitHub PR if --github flag is set
  if (opts.github) {
    const ghRepo = process.env.GH_REPO
    const prNumberRaw = process.env.PR_NUMBER ?? args.trim()
    const prNumber = parseInt(prNumberRaw, 10)

    if (!ghRepo) {
      console.error('\n[GitHub] Skipping: GH_REPO env not set (use --repo owner/name)')
      return
    }
    if (isNaN(prNumber) || prNumber <= 0) {
      console.error(`\n[GitHub] Skipping: could not parse PR number from "${prNumberRaw}"`)
      return
    }

    const [owner, repo] = ghRepo.split('/')
    if (!owner || !repo) {
      console.error(`\n[GitHub] Skipping: invalid GH_REPO format "${ghRepo}" (expected owner/repo)`)
      return
    }

    console.log(`\nFetching diff for PR #${prNumber}...`)
    let diffText = ''
    try {
      diffText = await Bun.$`gh pr diff ${prNumber} --repo ${ghRepo}`.quiet().text()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[GitHub] Failed to fetch diff: ${msg}`)
      return
    }

    console.log(`Posting review to ${owner}/${repo} PR #${prNumber}...`)
    try {
      const { commentCount } = await postPrReview({
        owner,
        repo,
        prNumber,
        bugs: result.bugs,
        diffText,
        duration: result.duration,
        flowDiagram: result.flowDiagram,
      })
      console.log(`[GitHub] Posted review with ${commentCount} line comment(s).`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[GitHub] Failed to post review: ${msg}`)
    }
  }
}
