import type React from 'react'
import { reviewCommand } from './review.ts'
import { ultrareviewCommand } from './ultrareview/command.tsx'

// ---------------------------------------------------------------------------
// Callback type used by local-jsx commands when they complete
// ---------------------------------------------------------------------------
export type OnDoneFn = (result: string, opts?: { shouldQuery?: boolean }) => void

// ---------------------------------------------------------------------------
// Base fields shared by all command types
// ---------------------------------------------------------------------------
type CommandBase = {
  name: string
  description: string
  aliases?: string[]
}

// ---------------------------------------------------------------------------
// PromptCommand — returns text that gets forwarded to the AI
// ---------------------------------------------------------------------------
export type PromptCommand = CommandBase & {
  type: 'prompt'
  getPromptForCommand(args: string): Promise<string>
}

// ---------------------------------------------------------------------------
// LocalJSXCommand — executes locally, renders Ink JSX in the terminal
// ---------------------------------------------------------------------------
export type LocalJSXCommand = CommandBase & {
  type: 'local-jsx'
  isEnabled?: () => boolean
  call(onDone: OnDoneFn, args: string): Promise<React.ReactNode | null>
}

// ---------------------------------------------------------------------------
// Union of all command variants
// ---------------------------------------------------------------------------
export type Command = PromptCommand | LocalJSXCommand

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------
export function getCommands(): Command[] {
  return [reviewCommand, ultrareviewCommand]
}

// ---------------------------------------------------------------------------
// Parse "/commandName args..." from raw user input
// Returns null for non-slash inputs
// ---------------------------------------------------------------------------
export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const withoutSlash = trimmed.slice(1)
  const spaceIdx = withoutSlash.indexOf(' ')

  if (spaceIdx === -1) {
    return { name: withoutSlash.toLowerCase(), args: '' }
  }

  return {
    name: withoutSlash.slice(0, spaceIdx).toLowerCase(),
    args: withoutSlash.slice(spaceIdx + 1).trim(),
  }
}
