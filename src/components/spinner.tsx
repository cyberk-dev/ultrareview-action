// ---------------------------------------------------------------------------
// Ultrareview progress spinner — shows session info + stage progress bar.
// ---------------------------------------------------------------------------
import React from 'react'
import { Box, Text } from 'ink'
import chalk from 'chalk'
import type { RemoteSession } from '../commands/ultrareview/remote-launch.ts'
import type { ReviewProgress } from '../tasks/remote-task.ts'

// ---------------------------------------------------------------------------
// Progress bar helpers
// ---------------------------------------------------------------------------

const BAR_WIDTH = 12

function stagePercent(stage: ReviewProgress['stage']): number {
  switch (stage) {
    case 'finding': return 0.33
    case 'verifying': return 0.66
    case 'synthesizing': return 0.90
    case 'done': return 1.0
  }
}

function renderBar(pct: number): string {
  const filled = Math.round(BAR_WIDTH * pct)
  const empty = BAR_WIDTH - filled
  return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty))
}

function stageLabel(stage: ReviewProgress['stage']): string {
  switch (stage) {
    case 'finding': return 'Finding bugs    '
    case 'verifying': return 'Verifying       '
    case 'synthesizing': return 'Synthesizing    '
    case 'done': return 'Done            '
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type SpinnerProps = {
  session: RemoteSession
  progress: ReviewProgress
}

export function Spinner({ session, progress }: SpinnerProps) {
  const pct = stagePercent(progress.stage)
  const bar = renderBar(pct)
  const label = stageLabel(progress.stage)
  const isDone = progress.stage === 'done'

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">Ultrareview running (~2 min)</Text>
      <Text>
        <Text color="gray">Session: </Text>
        <Text color="yellow">{session.id}</Text>
      </Text>
      <Text>
        <Text color="gray">Track:   </Text>
        <Text color="blue">{session.url}</Text>
      </Text>
      <Box marginTop={1}>
        <Text>
          <Text color="gray">Stage: </Text>
          <Text>{label}</Text>
          <Text>{bar}  </Text>
          {!isDone && (
            <Text color="green">
              {progress.bugsFound} found
              {progress.bugsVerified > 0 ? `  ${progress.bugsVerified}/${progress.bugsFound} verified` : ''}
            </Text>
          )}
          {isDone && <Text color="green">complete</Text>}
        </Text>
      </Box>
    </Box>
  )
}
