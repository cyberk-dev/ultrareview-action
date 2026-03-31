import { test, expect, describe } from 'bun:test'
import { z } from 'zod'
import { buildTool } from '../tool.ts'
import type { ToolUseContext } from '../tool.ts'

describe('buildTool', () => {
  test('fills in default values', () => {
    const testDef = {
      name: 'test-tool',
      inputSchema: z.object({ test: z.string() }),
      call: async () => ({ data: 'result' }),
      description: () => 'A test tool',
      prompt: () => 'Test prompt',
    }

    const tool = buildTool(testDef)

    expect(tool.name).toBe('test-tool')
    expect(tool.maxResultSizeChars).toBe(200_000)
    expect(tool.isEnabled()).toBe(true)
    expect(tool.isConcurrencySafe()).toBe(false)
    expect(tool.isReadOnly()).toBe(false)
  })

  test('preserves overridden values', () => {
    const testDef = {
      name: 'custom-tool',
      inputSchema: z.object({}),
      maxResultSizeChars: 50_000,
      call: async () => ({ data: 'result' }),
      description: () => 'Custom tool',
      prompt: () => 'Custom prompt',
      isEnabled: () => false,
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
    }

    const tool = buildTool(testDef)

    expect(tool.maxResultSizeChars).toBe(50_000)
    expect(tool.isEnabled()).toBe(false)
    expect(tool.isConcurrencySafe()).toBe(true)
    expect(tool.isReadOnly()).toBe(true)
  })

  test('checkPermissions returns allow by default', async () => {
    const testDef = {
      name: 'test-tool',
      inputSchema: z.object({}),
      call: async () => ({ data: 'result' }),
      description: () => 'Test',
      prompt: () => 'Test',
    }

    const tool = buildTool(testDef)
    const result = await tool.checkPermissions({})

    expect(result).toEqual({ behavior: 'allow' })
  })

  test('respects custom checkPermissions', async () => {
    const testDef = {
      name: 'test-tool',
      inputSchema: z.object({}),
      call: async () => ({ data: 'result' }),
      description: () => 'Test',
      prompt: () => 'Test',
      checkPermissions: async () => ({ behavior: 'deny' as const, message: 'Not allowed' }),
    }

    const tool = buildTool(testDef)
    const result = await tool.checkPermissions({})

    expect(result).toEqual({ behavior: 'deny', message: 'Not allowed' })
  })

  test('renderToolUseMessage returns null by default', () => {
    const testDef = {
      name: 'test-tool',
      inputSchema: z.object({}),
      call: async () => ({ data: 'result' }),
      description: () => 'Test',
      prompt: () => 'Test',
    }

    const tool = buildTool(testDef)
    const result = tool.renderToolUseMessage({})

    expect(result).toBeNull()
  })
})
