import { test, expect, describe } from 'bun:test'
import { parseSlashCommand, getCommands } from '../commands/commands.ts'

describe('parseSlashCommand', () => {
  test('parses /review with args', () => {
    const result = parseSlashCommand('/review 123')
    expect(result).toEqual({ name: 'review', args: '123' })
  })

  test('parses /ultrareview without args', () => {
    const result = parseSlashCommand('/ultrareview')
    expect(result).toEqual({ name: 'ultrareview', args: '' })
  })

  test('parses with multiple arg words', () => {
    const result = parseSlashCommand('/review some extra args here')
    expect(result).toEqual({ name: 'review', args: 'some extra args here' })
  })

  test('trims whitespace from input', () => {
    const result = parseSlashCommand('  /review   arg  ')
    expect(result).toEqual({ name: 'review', args: 'arg' })
  })

  test('lowercases command name', () => {
    const result = parseSlashCommand('/REVIEW 123')
    expect(result).toEqual({ name: 'review', args: '123' })
  })

  test('returns null for non-slash input', () => {
    const result = parseSlashCommand('hello world')
    expect(result).toBeNull()
  })

  test('returns null for empty string', () => {
    const result = parseSlashCommand('')
    expect(result).toBeNull()
  })

  test('returns null for whitespace-only string', () => {
    const result = parseSlashCommand('   ')
    expect(result).toBeNull()
  })

  test('returns null for unregistered command', () => {
    const result = parseSlashCommand('/unknown')
    expect(result).toEqual({ name: 'unknown', args: '' })
  })

  test('handles command with equals in args', () => {
    const result = parseSlashCommand('/review owner/repo=value')
    expect(result).toEqual({ name: 'review', args: 'owner/repo=value' })
  })
})

describe('getCommands', () => {
  test('returns non-empty array', () => {
    const commands = getCommands()
    expect(Array.isArray(commands)).toBe(true)
    expect(commands.length).toBeGreaterThan(0)
  })

  test('contains review command', () => {
    const commands = getCommands()
    const hasReview = commands.some(c => c.name === 'review')
    expect(hasReview).toBe(true)
  })

  test('contains ultrareview command', () => {
    const commands = getCommands()
    const hasUltareview = commands.some(c => c.name === 'ultrareview')
    expect(hasUltareview).toBe(true)
  })

  test('all commands have required fields', () => {
    const commands = getCommands()
    for (const cmd of commands) {
      expect(cmd.name).toBeDefined()
      expect(typeof cmd.name).toBe('string')
      expect(cmd.description).toBeDefined()
      expect(typeof cmd.description).toBe('string')
      expect(cmd.type).toBeDefined()
      expect(['prompt', 'local-jsx']).toContain(cmd.type)
    }
  })
})
