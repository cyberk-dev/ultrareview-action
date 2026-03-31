// ---------------------------------------------------------------------------
// Feedback Collector — auto-save review results to dataset after each PR review.
// When PR is merged/closed, check if bugs were resolved/dismissed → label ground truth.
// Triggers optimizer when enough labeled data accumulates.
// ---------------------------------------------------------------------------

import type { Bug, FleetResult } from '../utils/mock-fleet.ts'

const FEEDBACK_DIR = process.env.FEEDBACK_DIR ?? 'benchmark/feedback'
const OPTIMIZER_THRESHOLD = parseInt(process.env.OPTIMIZER_THRESHOLD ?? '20', 10)

export type FeedbackSample = {
  id: string
  repo: string
  prNumber: number
  timestamp: string
  diffSize: number
  bugs: Bug[]
  duration: number
  // Ground truth — filled when PR is merged/closed
  groundTruth?: {
    prMerged: boolean
    resolvedBugs: string[]   // bug titles that were addressed (comments resolved)
    dismissedBugs: string[]  // bug titles that were dismissed
    labeledAt?: string
  }
}

// ---------------------------------------------------------------------------
// Save review result as feedback sample (called after every PR review)
// ---------------------------------------------------------------------------
export async function saveFeedback(options: {
  owner: string
  repo: string
  prNumber: number
  diffText: string
  result: FleetResult
}): Promise<string> {
  const { owner, repo, prNumber, diffText, result } = options
  const sampleId = `${owner}-${repo}-pr${prNumber}`
  const sample: FeedbackSample = {
    id: sampleId,
    repo: `${owner}/${repo}`,
    prNumber,
    timestamp: new Date().toISOString(),
    diffSize: diffText.length,
    bugs: result.bugs,
    duration: result.duration,
  }

  await Bun.$`mkdir -p ${FEEDBACK_DIR}`.quiet()
  const filePath = `${FEEDBACK_DIR}/${sampleId}.json`
  await Bun.write(filePath, JSON.stringify(sample, null, 2))

  // Save diff separately
  await Bun.write(`${FEEDBACK_DIR}/${sampleId}.diff`, diffText)

  console.log(`[feedback] Saved ${filePath} (${result.bugs.length} bugs)`)
  return filePath
}

// ---------------------------------------------------------------------------
// Label feedback with ground truth (called when PR merged/closed event)
// ---------------------------------------------------------------------------
export async function labelFeedback(options: {
  owner: string
  repo: string
  prNumber: number
}): Promise<void> {
  const { owner, repo, prNumber } = options
  const sampleId = `${owner}-${repo}-pr${prNumber}`
  const filePath = `${FEEDBACK_DIR}/${sampleId}.json`

  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    console.log(`[feedback] No feedback found for ${sampleId}, skipping`)
    return
  }

  const sample: FeedbackSample = await file.json()

  // Check PR state
  const prState = await Bun.$`gh pr view ${prNumber} --repo ${owner}/${repo} --json state,reviewDecision --jq '{state: .state, decision: .reviewDecision}'`
    .quiet().text().catch(() => '{}')
  const { state } = JSON.parse(prState || '{}') as { state?: string }

  // Check which review comments were resolved vs pending
  const reviewComments = await Bun.$`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq '[.[] | select(.user.login == "github-actions[bot]") | {id: .id, body: .body, resolved: (.position == null)}]'`
    .quiet().text().catch(() => '[]')
  const comments = JSON.parse(reviewComments || '[]') as Array<{ body: string; resolved: boolean }>

  // Match comments to bugs by title
  const resolvedBugs: string[] = []
  const dismissedBugs: string[] = []

  for (const bug of sample.bugs) {
    const matching = comments.find(c => c.body.includes(bug.title))
    if (!matching) continue
    // If comment thread is resolved → bug was addressed
    // Heuristic: resolved comments = fixed, unresolved on merged PR = dismissed
    if (matching.resolved) {
      resolvedBugs.push(bug.title)
    } else if (state === 'MERGED') {
      dismissedBugs.push(bug.title)
    }
  }

  sample.groundTruth = {
    prMerged: state === 'MERGED',
    resolvedBugs,
    dismissedBugs,
    labeledAt: new Date().toISOString(),
  }

  await Bun.write(filePath, JSON.stringify(sample, null, 2))
  console.log(`[feedback] Labeled ${sampleId}: ${resolvedBugs.length} resolved, ${dismissedBugs.length} dismissed`)

  // Check if enough labeled data → trigger optimizer
  await checkOptimizerTrigger()
}

// ---------------------------------------------------------------------------
// Check if enough labeled feedback samples → trigger optimization
// ---------------------------------------------------------------------------
async function checkOptimizerTrigger(): Promise<void> {
  const glob = new Bun.Glob('*.json')
  let labeledCount = 0

  for await (const path of glob.scan(FEEDBACK_DIR)) {
    const file = Bun.file(`${FEEDBACK_DIR}/${path}`)
    const sample: FeedbackSample = await file.json()
    if (sample.groundTruth?.labeledAt) labeledCount++
  }

  if (labeledCount >= OPTIMIZER_THRESHOLD) {
    console.log(`[feedback] ${labeledCount} labeled samples ≥ threshold (${OPTIMIZER_THRESHOLD})`)
    console.log(`[feedback] Run optimizer: bun run src/eval/run-optimizer.ts --dataset ${FEEDBACK_DIR}/`)
    // Don't auto-run — just notify. Human should trigger optimizer.
  } else {
    console.log(`[feedback] ${labeledCount}/${OPTIMIZER_THRESHOLD} labeled samples — need more data`)
  }
}

// ---------------------------------------------------------------------------
// Convert labeled feedback to golden dataset format
// ---------------------------------------------------------------------------
export async function exportToGoldenDataset(outputPath?: string): Promise<void> {
  const out = outputPath ?? 'benchmark/golden-review-dataset-from-feedback.json'
  const glob = new Bun.Glob('*.json')
  const samples: Array<Record<string, unknown>> = []

  for await (const path of glob.scan(FEEDBACK_DIR)) {
    const file = Bun.file(`${FEEDBACK_DIR}/${path}`)
    const sample: FeedbackSample = await file.json()
    if (!sample.groundTruth?.labeledAt) continue

    // Convert resolved bugs → injected_bugs (ground truth)
    const injectedBugs = sample.bugs
      .filter(b => sample.groundTruth!.resolvedBugs.includes(b.title))
      .map(b => ({
        file: b.file,
        line: b.line ?? 0,
        severity: b.severity,
        category: 'logic' as const,
        title: b.title,
        description: b.description,
      }))

    samples.push({
      id: sample.id,
      source: `${sample.repo}#${sample.prNumber}`,
      description: `Mined from PR feedback — ${injectedBugs.length} confirmed bugs`,
      injected_bugs: injectedBugs,
    })
  }

  await Bun.write(out, JSON.stringify(samples, null, 2))
  console.log(`[feedback] Exported ${samples.length} labeled samples to ${out}`)
}
