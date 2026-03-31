import { test, expect, describe, beforeEach, mock } from 'bun:test'
import { chat, chatStream } from '../services/ai-client.ts'

describe('ai-client', () => {
  beforeEach(() => {
    // Reset fetch mocks between tests
  })

  test('chat builds correct request headers', async () => {
    let capturedInit: RequestInit | undefined

    const originalFetch = global.fetch
    global.fetch = mock((url: string, init?: RequestInit) => {
      capturedInit = init
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }],
          }),
        ),
      )
    }) as any

    try {
      await chat([{ role: 'user', content: 'Test message' }])

      expect(capturedInit).toBeDefined()
      expect(capturedInit?.headers).toBeDefined()
      const headers = capturedInit?.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['Authorization']).toBeDefined()
    } finally {
      global.fetch = originalFetch
    }
  })

  test('chat returns response text', async () => {
    const originalFetch = global.fetch
    global.fetch = mock(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Hello, world!' }, finish_reason: 'stop' }],
          }),
        ),
      )
    }) as any

    try {
      const result = await chat([{ role: 'user', content: 'Test' }])
      expect(result).toBe('Hello, world!')
    } finally {
      global.fetch = originalFetch
    }
  })

  test('chat handles empty response', async () => {
    const originalFetch = global.fetch
    global.fetch = mock(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '' }, finish_reason: 'stop' }],
          }),
        ),
      )
    }) as any

    try {
      const result = await chat([{ role: 'user', content: 'Test' }])
      expect(result).toBe('')
    } finally {
      global.fetch = originalFetch
    }
  })

  test('chat throws on error response', async () => {
    const originalFetch = global.fetch
    global.fetch = mock(() => {
      return Promise.resolve(new Response('Error', { status: 400 }))
    }) as any

    try {
      await expect(
        chat([{ role: 'user', content: 'Test' }]),
      ).rejects.toThrow()
    } finally {
      global.fetch = originalFetch
    }
  })

  test('chatStream yields tokens progressively', async () => {
    const originalFetch = global.fetch

    const sseData = `data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}
data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: [DONE]
`

    global.fetch = mock(() => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData))
          controller.close()
        },
      })

      return Promise.resolve(
        new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      )
    }) as any

    try {
      const tokens: string[] = []
      for await (const token of chatStream([{ role: 'user', content: 'Test' }])) {
        tokens.push(token)
      }

      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.join('').includes('Hello')).toBe(true)
    } finally {
      global.fetch = originalFetch
    }
  })

  test('chatStream respects system prompt', async () => {
    let capturedBody: any

    const originalFetch = global.fetch
    global.fetch = mock((url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string)
      }
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: [DONE]\n'))
          c.close()
        },
      })
      return Promise.resolve(new Response(stream))
    }) as any

    try {
      for await (const _ of chatStream(
        [{ role: 'user', content: 'Test' }],
        { system: 'You are helpful' },
      )) {
        // consume stream
      }

      // In OpenAI format, system message goes in messages array
      expect(capturedBody?.messages[0]).toBeDefined()
      expect(capturedBody?.messages[0].role).toBe('system')
      expect(capturedBody?.messages[0].content).toBe('You are helpful')
    } finally {
      global.fetch = originalFetch
    }
  })

  test('chatStream respects maxTokens', async () => {
    let capturedBody: any

    const originalFetch = global.fetch
    global.fetch = mock((url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string)
      }
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: [DONE]\n'))
          c.close()
        },
      })
      return Promise.resolve(new Response(stream))
    }) as any

    try {
      for await (const _ of chatStream([{ role: 'user', content: 'Test' }], {
        maxTokens: 1024,
      })) {
        // consume stream
      }

      expect(capturedBody?.max_tokens).toBe(1024)
    } finally {
      global.fetch = originalFetch
    }
  })
})
