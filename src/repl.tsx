import React, { useState, useCallback } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { getCommands, parseSlashCommand } from './commands/commands.ts'
import type { Command, OnDoneFn } from './commands/commands.ts'
import { chatStream } from './services/ai-client.ts'
import { REVIEW_SYSTEM_PROMPT } from './commands/review.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type MessageEntry =
  | { type: 'input'; text: string }
  | { type: 'output'; text: string; id?: string }
  | { type: 'jsx'; node: React.ReactNode; id: string }

// ---------------------------------------------------------------------------
// Simple TextInput built on useInput (ink-text-input not installed)
// ---------------------------------------------------------------------------
function TextInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string
  onChange: (val: string) => void
  onSubmit: (val: string) => void
  disabled?: boolean
}) {
  useInput((char, key) => {
    if (disabled) return
    if (key.return) {
      onSubmit(value)
      return
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1))
      return
    }
    if (key.ctrl || key.meta) return
    if (char) onChange(value + char)
  })

  if (disabled) {
    return (
      <Text>
        <Text color="yellow">{'... '}</Text>
        <Text dimColor>AI thinking...</Text>
      </Text>
    )
  }

  return (
    <Text>
      <Text color="green">{'> '}</Text>
      {value}
      <Text color="green">{'█'}</Text>
    </Text>
  )
}

// ---------------------------------------------------------------------------
// Render a single message entry
// ---------------------------------------------------------------------------
function MessageView({ entry }: { entry: MessageEntry }) {
  if (entry.type === 'input') {
    return (
      <Text>
        <Text color="green">{'> '}</Text>
        <Text>{entry.text}</Text>
      </Text>
    )
  }
  if (entry.type === 'output') {
    return <Text color="gray">{entry.text}</Text>
  }
  // jsx type
  return <Box>{entry.node as React.ReactElement}</Box>
}

// ---------------------------------------------------------------------------
// Built-in /help command text
// ---------------------------------------------------------------------------
function buildHelpText(commands: Command[]): string {
  const lines: string[] = ['Available commands:']
  lines.push('  /help       Show this help')
  lines.push('  /exit       Exit the application')
  for (const cmd of commands) {
    const aliases = cmd.aliases?.length ? ` (aliases: ${cmd.aliases.join(', ')})` : ''
    lines.push(`  /${cmd.name.padEnd(10)} ${cmd.description}${aliases}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// REPL component
// ---------------------------------------------------------------------------
export function Repl({ initialInput }: { initialInput?: string }) {
  const { exit } = useApp()
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<MessageEntry[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  const addOutput = useCallback((text: string) => {
    setMessages(prev => [...prev, { type: 'output', text }])
  }, [])

  const addJSX = useCallback((node: React.ReactNode, id: string) => {
    setMessages(prev => [...prev, { type: 'jsx', node, id }])
  }, [])

  /** Stream AI response for a prompt command, updating the last message live */
  const streamAIResponse = useCallback(async (promptText: string) => {
    const streamId = `stream-${Date.now()}`

    // Add placeholder output message
    setMessages(prev => [...prev, { type: 'output', text: '', id: streamId }])
    setIsStreaming(true)

    try {
      let accumulated = ''
      const stream = chatStream(
        [{ role: 'user', content: promptText }],
        { system: REVIEW_SYSTEM_PROMPT },
      )

      for await (const token of stream) {
        accumulated += token
        const snapshot = accumulated
        setMessages(prev =>
          prev.map(m =>
            m.type === 'output' && m.id === streamId
              ? { ...m, text: snapshot }
              : m,
          ),
        )
      }

      // If nothing came back, show placeholder
      if (!accumulated) {
        setMessages(prev =>
          prev.map(m =>
            m.type === 'output' && m.id === streamId
              ? { ...m, text: '(no response)' }
              : m,
          ),
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages(prev =>
        prev.map(m =>
          m.type === 'output' && m.id === streamId
            ? { ...m, text: `AI error: ${msg}` }
            : m,
        ),
      )
    } finally {
      setIsStreaming(false)
    }
  }, [])

  const handleSubmit = useCallback(async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || isStreaming) return

    setInputValue('')
    setMessages(prev => [...prev, { type: 'input', text: trimmed }])

    const parsed = parseSlashCommand(trimmed)

    if (!parsed) {
      addOutput('Type /help for available commands.')
      return
    }

    // Built-in: /exit
    if (parsed.name === 'exit' || parsed.name === 'quit') {
      exit()
      return
    }

    // Built-in: /help
    if (parsed.name === 'help') {
      addOutput(buildHelpText(getCommands()))
      return
    }

    // Look up in registry
    const allCommands = getCommands()
    const cmd = allCommands.find(
      c => c.name === parsed.name || (c.aliases ?? []).includes(parsed.name),
    )

    if (!cmd) {
      addOutput(`Unknown command: /${parsed.name}. Type /help for available commands.`)
      return
    }

    // Dispatch by command type
    if (cmd.type === 'prompt') {
      addOutput('Fetching...')
      let promptText: string
      try {
        promptText = await cmd.getPromptForCommand(parsed.args)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        addOutput(`Error: ${msg}`)
        return
      }

      // Remove the "Fetching..." message and stream AI response
      setMessages(prev => prev.filter(m => !(m.type === 'output' && m.text === 'Fetching...')))
      await streamAIResponse(promptText)
      return
    }

    if (cmd.type === 'local-jsx') {
      if (cmd.isEnabled && !cmd.isEnabled()) {
        addOutput(`Command /${cmd.name} is currently disabled.`)
        return
      }

      const onDone: OnDoneFn = (result, _opts) => {
        if (result) addOutput(result)
      }

      const node = await cmd.call(onDone, parsed.args)
      if (node) {
        const id = `jsx-${Date.now()}`
        addJSX(node, id)
      }
    }
  }, [addOutput, addJSX, exit, isStreaming, streamAIResponse])

  // Run initialInput once on mount
  React.useEffect(() => {
    if (initialInput?.trim()) {
      void handleSubmit(initialInput)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Box flexDirection="column">
      {messages.map((entry, i) => (
        <MessageView key={i} entry={entry} />
      ))}
      <TextInput
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        disabled={isStreaming}
      />
    </Box>
  )
}
