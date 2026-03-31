// ---------------------------------------------------------------------------
// Remote task polling — mock progressive stages every 3s.
// At the synthesizing stage, runs the agent loop pipeline (classify → verify → judge → filter).
// ---------------------------------------------------------------------------
import type { ReviewContext } from '../commands/ultrareview/remote-launch.ts'
import { runAgentLoop } from '../agent/agent-loop.ts'
import type { FleetResult } from '../utils/mock-fleet.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewStage = 'finding' | 'verifying' | 'synthesizing' | 'done'

export type ReviewProgress = {
  stage: ReviewStage
  bugsFound: number
  bugsVerified: number
  bugsRefuted: number
}

type OnProgress = (progress: ReviewProgress) => void
export type OnComplete = (result: FleetResult) => void

// ---------------------------------------------------------------------------
// Mock tick sequence
// Each entry: [stage, bugsFound, bugsVerified, bugsRefuted]
// ---------------------------------------------------------------------------
type TickData = [ReviewStage, number, number, number]

const TICKS: TickData[] = [
  ['finding', 0, 0, 0],      // t=0
  ['finding', 1, 0, 0],      // t=3
  ['finding', 3, 0, 0],      // t=6
  ['verifying', 3, 1, 0],    // t=9
  ['verifying', 3, 2, 1],    // t=12
  ['synthesizing', 3, 2, 1], // t=15 — triggers fleet
]

// ---------------------------------------------------------------------------
// Derive diff + description from ReviewContext
// ---------------------------------------------------------------------------

function extractFleetInput(context: ReviewContext): { diff: string; description: string } {
  const diff = context.diff ?? ''
  const description = context.mode === 'pr' ? (context.description ?? '') : ''
  return { diff, description }
}

// ---------------------------------------------------------------------------
// Start polling — returns a cancel handle
// ---------------------------------------------------------------------------

export function startRemoteTaskPolling(
  context: ReviewContext,
  onProgress: OnProgress,
  onComplete: OnComplete,
): { cancel: () => void } {
  let tickIndex = 0
  let cancelled = false
  let fleetRunning = false

  // Emit the initial state immediately
  const first = TICKS[0]
  if (first) {
    onProgress({ stage: first[0], bugsFound: first[1], bugsVerified: first[2], bugsRefuted: first[3] })
  }

  const timer = setInterval(() => {
    if (cancelled) return

    tickIndex++

    if (tickIndex < TICKS.length) {
      const tick = TICKS[tickIndex]
      if (tick) {
        onProgress({ stage: tick[0], bugsFound: tick[1], bugsVerified: tick[2], bugsRefuted: tick[3] })

        // When we hit synthesizing, kick off the real fleet (once)
        if (tick[0] === 'synthesizing' && !fleetRunning) {
          fleetRunning = true
          clearInterval(timer)

          const { diff } = extractFleetInput(context)

          if (!diff || diff.trim().length === 0) {
            if (!cancelled) {
              onProgress({ stage: 'done', bugsFound: 0, bugsVerified: 0, bugsRefuted: 0 })
              onComplete({ bugs: [], duration: 0 })
            }
            return
          }

          const repoRoot = process.cwd()
          void runAgentLoop(diff, repoRoot, (step, detail) => {
            if (!cancelled) {
              onProgress({ stage: 'synthesizing', bugsFound: 0, bugsVerified: 0, bugsRefuted: 0 })
            }
          })
            .then((result) => {
              if (cancelled) return
              const verified = result.bugs.filter(b => b.verified).length
              const refuted = result.bugs.filter(b => !b.verified).length
              onProgress({ stage: 'done', bugsFound: result.bugs.length, bugsVerified: verified, bugsRefuted: refuted })
              onComplete(result)
            })
            .catch((err: unknown) => {
              if (cancelled) return
              const msg = err instanceof Error ? err.message : String(err)
              // Graceful failure: complete with empty result + error note
              const errorResult: FleetResult = {
                bugs: [{
                  severity: 'low',
                  file: 'N/A',
                  title: 'AI fleet unavailable',
                  description: `Fleet error: ${msg}`,
                  suggestion: 'Check AI_BASE_URL and AI_API_KEY environment variables.',
                  verified: false,
                }],
                duration: 0,
              }
              onProgress({ stage: 'done', bugsFound: 1, bugsVerified: 0, bugsRefuted: 1 })
              onComplete(errorResult)
            })
        }
      }
      return
    }

    // Should not reach here normally — fleet path clears the timer
    clearInterval(timer)
    if (!cancelled) {
      onProgress({ stage: 'done', bugsFound: 0, bugsVerified: 0, bugsRefuted: 0 })
      onComplete({ bugs: [], duration: 0 })
    }
  }, 3000)

  return {
    cancel() {
      cancelled = true
      clearInterval(timer)
    },
  }
}
