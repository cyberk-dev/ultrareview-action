import { test, expect, describe, beforeEach } from 'bun:test'
import { checkOverageGate, confirmOverage } from '../commands/ultrareview/quota-gate.ts'

describe('checkOverageGate', () => {
  beforeEach(() => {
    // Reset session flag by relaunching the module
    // Note: in a real test we'd reset module state; here we rely on test isolation
  })

  test('MOCK_QUOTA=free returns proceed with Free billing note', async () => {
    const original = process.env.MOCK_QUOTA
    process.env.MOCK_QUOTA = 'free'

    try {
      const result = await checkOverageGate()
      expect(result.kind).toBe('proceed')
      if (result.kind === 'proceed') {
        expect(result.billingNote).toContain('Free')
      }
    } finally {
      process.env.MOCK_QUOTA = original
    }
  })

  test('MOCK_QUOTA=exhausted returns not-enabled', async () => {
    const original = process.env.MOCK_QUOTA
    process.env.MOCK_QUOTA = 'exhausted'

    try {
      const result = await checkOverageGate()
      expect(result.kind).toBe('not-enabled')
    } finally {
      process.env.MOCK_QUOTA = original
    }
  })

  test('MOCK_QUOTA=low returns low-balance with available amount', async () => {
    const original = process.env.MOCK_QUOTA
    process.env.MOCK_QUOTA = 'low'

    try {
      const result = await checkOverageGate()
      expect(result.kind).toBe('low-balance')
      if (result.kind === 'low-balance') {
        expect(result.available).toBe(3.5)
      }
    } finally {
      process.env.MOCK_QUOTA = original
    }
  })

  test('MOCK_QUOTA=confirm returns needs-confirm without session flag', async () => {
    const original = process.env.MOCK_QUOTA
    process.env.MOCK_QUOTA = 'confirm'

    try {
      const result = await checkOverageGate()
      expect(result.kind).toBe('needs-confirm')
    } finally {
      process.env.MOCK_QUOTA = original
    }
  })

  test('MOCK_QUOTA=confirm returns proceed after confirmOverage is called', async () => {
    const original = process.env.MOCK_QUOTA
    process.env.MOCK_QUOTA = 'confirm'

    try {
      // First call should return needs-confirm
      const result1 = await checkOverageGate()
      expect(result1.kind).toBe('needs-confirm')

      // After confirming
      confirmOverage()

      // Second call should return proceed with billing note
      const result2 = await checkOverageGate()
      expect(result2.kind).toBe('proceed')
      if (result2.kind === 'proceed') {
        expect(result2.billingNote).toContain('Extra Usage')
      }
    } finally {
      process.env.MOCK_QUOTA = original
    }
  })

  test('no MOCK_QUOTA defaults to proceed', async () => {
    const original = process.env.MOCK_QUOTA
    delete process.env.MOCK_QUOTA

    try {
      const result = await checkOverageGate()
      expect(result.kind).toBe('proceed')
    } finally {
      process.env.MOCK_QUOTA = original
    }
  })

  test('invalid MOCK_QUOTA defaults to proceed', async () => {
    const original = process.env.MOCK_QUOTA
    process.env.MOCK_QUOTA = 'invalid-mode'

    try {
      const result = await checkOverageGate()
      expect(result.kind).toBe('proceed')
    } finally {
      process.env.MOCK_QUOTA = original
    }
  })
})
