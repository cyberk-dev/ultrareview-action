// ---------------------------------------------------------------------------
// Remote launch helpers — mock teleport + real git context gathering.
// In Phase 7 this will call the real CCR upload; for now it delays 2s.
// ---------------------------------------------------------------------------
import {
  getDiffAgainstBase,
  getCurrentBranch,
  getPrDiff,
  getPrView,
  assertGitRepo,
} from '../../utils/git.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RemoteSession = {
  id: string
  title: string
  url: string
}

export type ReviewContext =
  | { mode: 'pr'; prNumber: string; diff: string; description: string }
  | { mode: 'branch'; branch: string; diff: string }

// ---------------------------------------------------------------------------
// Mock teleport: simulate 2s upload delay, return fake session
// ---------------------------------------------------------------------------

export async function mockTeleport(args: string): Promise<RemoteSession> {
  await new Promise<void>(r => setTimeout(r, 2000))
  const id = `sess_${crypto.randomUUID().slice(0, 8)}`
  return {
    id,
    title: `ultrareview: ${args.trim() || 'current branch'}`,
    url: `https://claude.ai/code/sessions/${id}`,
  }
}

// ---------------------------------------------------------------------------
// Gather real git diff/view for the review context
// ---------------------------------------------------------------------------

export async function gatherReviewContext(args: string): Promise<ReviewContext> {
  // Skip git repo check when --repo flag provides explicit repo
  if (!process.env.GH_REPO) await assertGitRepo()

  const trimmed = args.trim()
  const isPR = /^\d+$/.test(trimmed)

  if (isPR) {
    const [diff, description] = await Promise.all([
      getPrDiff(trimmed),
      getPrView(trimmed),
    ])
    return { mode: 'pr', prNumber: trimmed, diff, description }
  }

  const [diff, branch] = await Promise.all([
    getDiffAgainstBase(),
    getCurrentBranch(),
  ])
  return { mode: 'branch', branch, diff }
}
