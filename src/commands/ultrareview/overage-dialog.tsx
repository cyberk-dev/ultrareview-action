// ---------------------------------------------------------------------------
// Overage billing confirmation dialog — shown when MOCK_QUOTA=confirm.
// Arrow keys navigate; Enter selects. Mirrors FavAI UltrareviewOverageDialog.
// ---------------------------------------------------------------------------
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OverageDialogProps = {
  onProceed: () => void
  onCancel: () => void
}

type Option = { label: string; description: string }

const OPTIONS: Option[] = [
  {
    label: 'Proceed with Extra Usage billing',
    description: 'Each ultrareview bills a small Extra Usage fee.',
  },
  {
    label: 'Cancel',
    description: 'Return to the REPL without running a review.',
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverageDialog({ onProceed, onCancel }: OverageDialogProps) {
  const [selected, setSelected] = useState(0)
  const [confirmed, setConfirmed] = useState(false)

  useInput((_, key) => {
    if (confirmed) return

    if (key.upArrow) {
      setSelected(prev => Math.max(0, prev - 1))
      return
    }
    if (key.downArrow) {
      setSelected(prev => Math.min(OPTIONS.length - 1, prev + 1))
      return
    }
    if (key.return) {
      setConfirmed(true)
      if (selected === 0) {
        onProceed()
      } else {
        onCancel()
      }
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
      <Text bold color="yellow">Free ultrareviews used</Text>
      <Text color="gray">Further reviews bill as Extra Usage (~$0.10 each).</Text>
      <Box marginTop={1} flexDirection="column">
        {OPTIONS.map((opt, i) => (
          <Text key={opt.label}>
            {selected === i
              ? <Text color="cyan" bold>{'> '}</Text>
              : <Text color="gray">{'  '}</Text>
            }
            <Text color={selected === i ? 'cyan' : 'white'}>{opt.label}</Text>
          </Text>
        ))}
      </Box>
      <Text color="gray" dimColor>Use ↑↓ to navigate, Enter to confirm.</Text>
    </Box>
  )
}
