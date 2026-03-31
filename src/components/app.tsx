import React from 'react'
import { Box, Text } from 'ink'

// ---------------------------------------------------------------------------
// Root Ink app wrapper — renders header + children (REPL)
// ---------------------------------------------------------------------------
export function App({ children }: { children: React.ReactNode }) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="cyan">Ultrareview Clone</Text>
        <Text color="gray"> v0.1  —  Type </Text>
        <Text color="yellow">/help</Text>
        <Text color="gray"> for commands, </Text>
        <Text color="yellow">/exit</Text>
        <Text color="gray"> to quit</Text>
      </Box>
      {children}
    </Box>
  )
}
