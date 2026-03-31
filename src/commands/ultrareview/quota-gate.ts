// ---------------------------------------------------------------------------
// Overage gate — mirrors FavAI's checkOverageGate() 4-state logic.
// Toggle via MOCK_QUOTA env: free | exhausted | low | confirm
// ---------------------------------------------------------------------------

export type OverageGate =
  | { kind: 'proceed'; billingNote: string }
  | { kind: 'not-enabled' }
  | { kind: 'low-balance'; available: number }
  | { kind: 'needs-confirm' }

// Session-wide flag: once user confirms overage, skip dialog for rest of process
let sessionOverageConfirmed = false

/** Call after user explicitly confirms overage billing in the dialog. */
export function confirmOverage(): void {
  sessionOverageConfirmed = true
}

/**
 * Check if the current session can proceed with an ultrareview.
 * Returns one of 4 gate states depending on MOCK_QUOTA env var.
 */
export async function checkOverageGate(): Promise<OverageGate> {
  const mode = process.env['MOCK_QUOTA'] ?? 'free'

  switch (mode) {
    case 'free':
      return { kind: 'proceed', billingNote: ' Free review 1 of 5.' }

    case 'exhausted':
      return { kind: 'not-enabled' }

    case 'low':
      return { kind: 'low-balance', available: 3.5 }

    case 'confirm':
      if (sessionOverageConfirmed) {
        return { kind: 'proceed', billingNote: ' Bills as Extra Usage.' }
      }
      return { kind: 'needs-confirm' }

    default:
      return { kind: 'proceed', billingNote: '' }
  }
}
