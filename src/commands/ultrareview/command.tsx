// ---------------------------------------------------------------------------
// /ultrareview command — local-jsx entry.
// Checks overage gate → shows dialog if needed → teleports + polls progress.
// On completion renders ReviewResult with structured bug report.
// ---------------------------------------------------------------------------
import React, { useState, useEffect } from 'react'
import { Text } from 'ink'
import type { LocalJSXCommand, OnDoneFn } from '../commands.ts'
import { checkOverageGate, confirmOverage } from './quota-gate.ts'
import { OverageDialog } from './overage-dialog.tsx'
import { mockTeleport, gatherReviewContext } from './remote-launch.ts'
import type { RemoteSession } from './remote-launch.ts'
import { startRemoteTaskPolling } from '../../tasks/remote-task.ts'
import type { ReviewProgress } from '../../tasks/remote-task.ts'
import type { FleetResult } from '../../utils/mock-fleet.ts'
import { Spinner } from '../../components/spinner.tsx'
import { ReviewResult } from '../../components/review-result.tsx'

// ---------------------------------------------------------------------------
// ReviewRunner — teleports, then polls, renders Spinner with live progress.
// On complete, switches to ReviewResult component.
// ---------------------------------------------------------------------------

type ReviewRunnerProps = { args: string; onDone: OnDoneFn }

function ReviewRunner({ args, onDone }: ReviewRunnerProps) {
  const [session, setSession] = useState<RemoteSession | null>(null)
  const [progress, setProgress] = useState<ReviewProgress>({
    stage: 'finding',
    bugsFound: 0,
    bugsVerified: 0,
    bugsRefuted: 0,
  })
  const [fleetResult, setFleetResult] = useState<FleetResult | null>(null)

  useEffect(() => {
    let cancelled = false
    let cancelPoll: (() => void) | null = null

    void (async () => {
      let context
      try {
        context = await gatherReviewContext(args)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!cancelled) onDone(`Error gathering context: ${msg}`, { shouldQuery: false })
        return
      }

      // Validate diff before proceeding
      if (!context.diff || context.diff.trim().length === 0) {
        if (!cancelled) onDone('No changes to review — diff is empty.', { shouldQuery: false })
        return
      }

      let sess: RemoteSession
      try {
        sess = await mockTeleport(args)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!cancelled) onDone(`Teleport failed: ${msg}`, { shouldQuery: false })
        return
      }

      if (cancelled) return
      setSession(sess)

      const { cancel } = startRemoteTaskPolling(
        context,
        (p) => { if (!cancelled) setProgress(p) },
        (result) => {
          if (!cancelled) {
            setFleetResult(result)
            // Also call onDone with a summary string for the REPL log
            const verified = result.bugs.filter(b => b.verified).length
            const summary = result.bugs.length === 0
              ? 'Ultrareview complete — no bugs found.'
              : `Ultrareview complete — ${result.bugs.length} bugs found (${verified} verified).`
            onDone(summary, { shouldQuery: false })
          }
        },
      )
      cancelPoll = cancel
    })()

    return () => {
      cancelled = true
      cancelPoll?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Show structured result once fleet completes
  if (fleetResult && session) {
    return <ReviewResult result={fleetResult} session={session} />
  }

  if (!session) return <Text color="gray">Teleporting to remote session…</Text>
  return <Spinner session={session} progress={progress} />
}

// ---------------------------------------------------------------------------
// UltrareviewRoot — manages dialog → runner transition in one mounted node
// ---------------------------------------------------------------------------

type Phase = 'dialog' | 'running' | 'cancelled'

type RootProps = { args: string; onDone: OnDoneFn; startWithConfirm: boolean }

function UltrareviewRoot({ args, onDone, startWithConfirm }: RootProps) {
  const [phase, setPhase] = useState<Phase>(startWithConfirm ? 'dialog' : 'running')

  switch (phase) {
    case 'dialog':
      return (
        <OverageDialog
          onProceed={() => {
            confirmOverage()
            setPhase('running')
          }}
          onCancel={() => {
            onDone('Ultrareview cancelled.')
            setPhase('cancelled')
          }}
        />
      )
    case 'cancelled':
      return <Text color="gray">Ultrareview cancelled.</Text>
    case 'running':
      return <ReviewRunner args={args} onDone={onDone} />
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export const ultrareviewCommand: LocalJSXCommand = {
  type: 'local-jsx',
  name: 'ultrareview',
  description: 'Deep bug-hunting review (~2 min)',
  aliases: ['ur'],

  async call(onDone: OnDoneFn, args: string): Promise<React.ReactNode | null> {
    const gate = await checkOverageGate()

    if (gate.kind === 'not-enabled') {
      onDone('Free ultrareviews used. Enable Extra Usage to continue.')
      return null
    }

    if (gate.kind === 'low-balance') {
      onDone(`Balance too low ($${gate.available.toFixed(2)}, $10 minimum).`)
      return null
    }

    const startWithConfirm = gate.kind === 'needs-confirm'
    return <UltrareviewRoot args={args} onDone={onDone} startWithConfirm={startWithConfirm} />
  },
}
