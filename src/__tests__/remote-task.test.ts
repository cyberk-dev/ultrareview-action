import { test, expect, describe, beforeEach } from 'bun:test'
import { startRemoteTaskPolling } from '../tasks/remote-task.ts'
import type { ReviewContext } from '../commands/ultrareview/remote-launch.ts'

describe('remote-task polling', () => {
  test('startRemoteTaskPolling returns cancel handle', () => {
    const context: ReviewContext = {
      mode: 'branch',
      branch: 'main',
      diff: 'diff content',
    }

    const onProgress = () => {}
    const onComplete = () => {}

    const handle = startRemoteTaskPolling(context, onProgress, onComplete)

    expect(handle).toHaveProperty('cancel')
    expect(typeof handle.cancel).toBe('function')

    handle.cancel()
  })

  test('startRemoteTaskPolling emits initial state immediately', () => {
    const context: ReviewContext = {
      mode: 'branch',
      branch: 'main',
      diff: 'diff content',
    }

    const progressUpdates: any[] = []
    const onProgress = (p: any) => progressUpdates.push(p)
    const onComplete = () => {}

    const handle = startRemoteTaskPolling(context, onProgress, onComplete)

    // Should emit at least initial state synchronously
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1)

    const firstUpdate = progressUpdates[0]
    expect(firstUpdate?.stage).toBeDefined()
    expect(['finding', 'verifying', 'synthesizing', 'done']).toContain(firstUpdate?.stage)
    expect(firstUpdate?.bugsFound).toBeDefined()
    expect(typeof firstUpdate?.bugsFound).toBe('number')

    handle.cancel()
  })

  test('cancel method is idempotent', () => {
    const context: ReviewContext = {
      mode: 'branch',
      branch: 'main',
      diff: 'diff content',
    }

    const onProgress = () => {}
    const onComplete = () => {}

    const handle = startRemoteTaskPolling(context, onProgress, onComplete)

    // Should not throw when called multiple times
    handle.cancel()
    handle.cancel()
    handle.cancel()

    expect(true).toBe(true)
  })

  test('handles empty diff without errors', () => {
    const context: ReviewContext = {
      mode: 'branch',
      branch: 'main',
      diff: '',
    }

    const progressUpdates: any[] = []
    const completions: any[] = []

    const onProgress = (p: any) => progressUpdates.push(p)
    const onComplete = (r: any) => completions.push(r)

    const handle = startRemoteTaskPolling(context, onProgress, onComplete)

    // Should emit at least initial state
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1)

    handle.cancel()
  })

  test('supports PR context mode', () => {
    const context: ReviewContext = {
      mode: 'pr',
      prNumber: '123',
      diff: 'diff content',
      description: 'PR description',
    }

    const progressUpdates: any[] = []
    const onProgress = (p: any) => progressUpdates.push(p)
    const onComplete = () => {}

    const handle = startRemoteTaskPolling(context, onProgress, onComplete)

    expect(progressUpdates.length).toBeGreaterThanOrEqual(1)

    handle.cancel()
  })

  test('progress updates contain all required fields', () => {
    const context: ReviewContext = {
      mode: 'branch',
      branch: 'main',
      diff: 'diff content',
    }

    const progressUpdates: any[] = []
    const onProgress = (p: any) => progressUpdates.push(p)
    const onComplete = () => {}

    const handle = startRemoteTaskPolling(context, onProgress, onComplete)

    expect(progressUpdates.length).toBeGreaterThanOrEqual(1)

    for (const update of progressUpdates) {
      expect(update).toHaveProperty('stage')
      expect(update).toHaveProperty('bugsFound')
      expect(update).toHaveProperty('bugsVerified')
      expect(update).toHaveProperty('bugsRefuted')
      expect(typeof update.bugsFound).toBe('number')
      expect(typeof update.bugsVerified).toBe('number')
      expect(typeof update.bugsRefuted).toBe('number')
    }

    handle.cancel()
  })
})
