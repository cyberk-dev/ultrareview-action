#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Label feedback when PR is merged/closed.
// Checks which review comments were resolved vs dismissed.
// Triggers optimizer notification when threshold reached.
// ---------------------------------------------------------------------------

import { labelFeedback } from '../eval/feedback-collector.ts'

async function main() {
  const prNumber = process.env.PR_NUMBER
  const owner = process.env.REPO_OWNER ?? process.env.GITHUB_REPOSITORY_OWNER
  const repoName = process.env.REPO_NAME ?? process.env.GITHUB_REPOSITORY?.split('/')[1]

  if (!prNumber || !owner || !repoName) {
    console.log('[label-feedback] Missing env vars, skipping')
    process.exit(0)
  }

  console.log(`[label-feedback] Labeling PR #${prNumber} on ${owner}/${repoName}`)
  await labelFeedback({ owner, repo: repoName, prNumber: parseInt(prNumber, 10) })
}

main().catch((err) => {
  console.warn(`[label-feedback] Failed: ${err instanceof Error ? err.message : err}`)
  process.exit(0)
})
