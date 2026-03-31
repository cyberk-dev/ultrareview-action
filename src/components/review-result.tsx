// ---------------------------------------------------------------------------
// ReviewResult — Ink component rendering structured bug report output.
// Color-coded by severity. Refuted bugs are dimmed.
// ---------------------------------------------------------------------------
import React from 'react'
import { Box, Text } from 'ink'
import type { Bug, FleetResult } from '../utils/mock-fleet.ts'
import type { RemoteSession } from '../commands/ultrareview/remote-launch.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityIcon(severity: Bug['severity']): string {
  switch (severity) {
    case 'critical': return '🔴'
    case 'high': return '🟠'
    case 'medium': return '🟡'
    case 'low': return '⚪'
  }
}

function severityColor(severity: Bug['severity']): string {
  switch (severity) {
    case 'critical': return 'red'
    case 'high': return 'yellow'
    case 'medium': return 'blue'
    case 'low': return 'gray'
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// Single bug entry
// ---------------------------------------------------------------------------

type BugEntryProps = { bug: Bug; index: number }

function BugEntry({ bug, index }: BugEntryProps) {
  const color = severityColor(bug.severity)
  const icon = severityIcon(bug.severity)
  const isRefuted = !bug.verified
  const label = isRefuted ? 'Refuted' : bug.severity.charAt(0).toUpperCase() + bug.severity.slice(1)
  const lineRef = bug.line ? `:${bug.line}` : ''

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor={isRefuted}>
        <Text color={isRefuted ? 'gray' : color} bold>
          {`${String(index + 1).padStart(2)}. ${icon} ${label}: ${bug.title}`}
        </Text>
      </Text>
      <Text dimColor={isRefuted}>
        <Text color="gray">    File: </Text>
        <Text color={isRefuted ? 'gray' : 'cyan'}>{`${bug.file}${lineRef}`}</Text>
      </Text>
      <Text dimColor={isRefuted}>
        <Text color="gray">    {bug.description}</Text>
      </Text>
      {!isRefuted && (
        <Text>
          <Text color="green">    Fix: </Text>
          <Text color="gray">{bug.suggestion}</Text>
        </Text>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ReviewResultProps = {
  result: FleetResult
  session: RemoteSession
}

// ---------------------------------------------------------------------------
// ReviewResult component
// ---------------------------------------------------------------------------

export function ReviewResult({ result, session }: ReviewResultProps) {
  const { bugs, duration } = result
  const verified = bugs.filter(b => b.verified)
  const refuted = bugs.filter(b => !b.verified)
  const critical = bugs.filter(b => b.verified && b.severity === 'critical').length
  const hasIssues = bugs.length > 0

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Text bold color="cyan">── Ultrareview Results ──────────────────────────</Text>
      <Text>
        <Text color="gray">Session:  </Text>
        <Text color="yellow">{session.id}</Text>
        <Text color="gray">  |  Duration: </Text>
        <Text color="white">{formatDuration(duration)}</Text>
      </Text>
      <Text>
        <Text color="gray">Found:    </Text>
        {hasIssues ? (
          <>
            <Text color={critical > 0 ? 'red' : 'yellow'} bold>{bugs.length} bugs</Text>
            <Text color="gray">  (</Text>
            <Text color="green">{verified.length} verified</Text>
            {refuted.length > 0 && (
              <>
                <Text color="gray">, </Text>
                <Text color="gray">{refuted.length} refuted</Text>
              </>
            )}
            <Text color="gray">)</Text>
          </>
        ) : (
          <Text color="green">No bugs found</Text>
        )}
      </Text>

      {/* Bug list */}
      {bugs.map((bug, i) => (
        <BugEntry key={`${bug.file}-${bug.title}`} bug={bug} index={i} />
      ))}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">────────────────────────────────────────────────</Text>
      </Box>
      {hasIssues && critical > 0 && (
        <Text color="red" bold>Action required: {critical} critical issue{critical > 1 ? 's' : ''} found.</Text>
      )}
      {!hasIssues && (
        <Text color="green">All clear — no issues detected in this diff.</Text>
      )}
    </Box>
  )
}
