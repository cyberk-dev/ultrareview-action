import type React from 'react'
import type { z } from 'zod'
import type { Command } from './commands/commands.ts'

// ---------------------------------------------------------------------------
// Context passed to every tool call
// ---------------------------------------------------------------------------
export type ToolUseContext = {
  abortController: AbortController
  commands: Command[]
  tools: Tool<unknown, unknown>[]
  cwd: string
}

// ---------------------------------------------------------------------------
// Permission result — allow or deny with message
// ---------------------------------------------------------------------------
export type PermissionResult =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string }

// ---------------------------------------------------------------------------
// Wrapper around tool output, may carry side-effect messages
// ---------------------------------------------------------------------------
export type ToolResult<T> = {
  data: T
  messages?: string[]
}

// ---------------------------------------------------------------------------
// Core Tool interface — 8 methods (simplified from FavAI)
// ---------------------------------------------------------------------------
export type Tool<Input, Output> = {
  name: string
  inputSchema: z.ZodType<Input>
  maxResultSizeChars: number

  call(args: Input, context: ToolUseContext): Promise<ToolResult<Output>>
  description(input: Input): string
  prompt(): string
  checkPermissions(input: Input): Promise<PermissionResult>
  isEnabled(): boolean
  isConcurrencySafe(): boolean
  isReadOnly(): boolean

  // Ink terminal rendering
  renderToolUseMessage(input: Partial<Input>): React.ReactNode
  renderToolResultMessage(output: Output): React.ReactNode
}

// ---------------------------------------------------------------------------
// ToolDef — partial input for buildTool (only required fields + optional overrides)
// ---------------------------------------------------------------------------
export type ToolDef<I, O> = {
  name: string
  inputSchema: z.ZodType<I>
  maxResultSizeChars?: number

  call(args: I, context: ToolUseContext): Promise<ToolResult<O>>
  description(input: I): string
  prompt(): string

  // Optional — defaults provided by buildTool
  checkPermissions?: (input: I) => Promise<PermissionResult>
  isEnabled?: () => boolean
  isConcurrencySafe?: () => boolean
  isReadOnly?: () => boolean
  renderToolUseMessage?: (input: Partial<I>) => React.ReactNode
  renderToolResultMessage?: (output: O) => React.ReactNode
}

// ---------------------------------------------------------------------------
// buildTool — fills in defaults so callers only specify what differs
// ---------------------------------------------------------------------------
export function buildTool<I, O>(def: ToolDef<I, O>): Tool<I, O> {
  return {
    name: def.name,
    inputSchema: def.inputSchema,
    maxResultSizeChars: def.maxResultSizeChars ?? 200_000,

    call: def.call,
    description: def.description,
    prompt: def.prompt,

    checkPermissions: def.checkPermissions ?? (() => Promise.resolve({ behavior: 'allow' as const })),
    isEnabled: def.isEnabled ?? (() => true),
    isConcurrencySafe: def.isConcurrencySafe ?? (() => false),
    isReadOnly: def.isReadOnly ?? (() => false),

    renderToolUseMessage: def.renderToolUseMessage ?? (() => null),
    renderToolResultMessage: def.renderToolResultMessage ?? (() => null),
  }
}
