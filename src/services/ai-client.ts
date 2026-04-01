// ---------------------------------------------------------------------------
// AI API wrapper — supports both OpenAI and Anthropic formats via env config
// AI_FORMAT=openai (default) | anthropic
// ---------------------------------------------------------------------------

const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://api.openai.com'
const AI_API_KEY = process.env.AI_API_KEY ?? ''
const AI_MODEL = process.env.AI_MODEL ?? 'gpt-5.4-mini'
const AI_FORMAT = (process.env.AI_FORMAT ?? 'openai') as 'openai' | 'anthropic'

export type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type ChatOptions = { system?: string; maxTokens?: number; timeoutMs?: number }

// ---------------------------------------------------------------------------
// Format-aware helpers
// ---------------------------------------------------------------------------

function buildHeaders(): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  if (AI_FORMAT === 'anthropic') {
    base['x-api-key'] = AI_API_KEY
    base['anthropic-version'] = '2023-06-01'
  } else {
    base['Authorization'] = `Bearer ${AI_API_KEY}`
  }
  return base
}

function endpoint(stream = false): string {
  if (AI_FORMAT === 'anthropic') return `${AI_BASE_URL}/v1/messages`
  return `${AI_BASE_URL}/v1/chat/completions`
}

type ApiMessage = { role: 'user' | 'assistant' | 'system'; content: string }

function buildBody(messages: Message[], opts: ChatOptions, stream: boolean) {
  const filtered: ApiMessage[] = AI_FORMAT === 'anthropic'
    ? messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : messages.map(m => ({ role: m.role, content: m.content }))

  if (AI_FORMAT === 'anthropic') {
    return {
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      messages: filtered,
      ...(stream ? { stream: true } : {}),
      ...(opts.system ? { system: opts.system } : {}),
    }
  }
  // OpenAI format: system message goes as first message
  const openaiMessages: ApiMessage[] = opts.system
    ? [{ role: 'system', content: opts.system }, ...filtered]
    : filtered
  return {
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    messages: openaiMessages,
    ...(stream ? { stream: true } : {}),
  }
}

// ---------------------------------------------------------------------------
// Non-streaming chat
// ---------------------------------------------------------------------------

export async function chat(messages: Message[], opts: ChatOptions = {}): Promise<string> {
  const body = buildBody(messages, opts, false)
  const timeout = opts.timeoutMs ?? 60_000
  const attempt = () => fetch(endpoint(), {
    method: 'POST', headers: buildHeaders(),
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  })

  let res = await attempt()
  if (res.status === 429 || res.status >= 500) {
    await new Promise(r => setTimeout(r, 2000))
    res = await attempt()
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI API error ${res.status}: ${text.slice(0, 200)}`)
  }

  if (AI_FORMAT === 'anthropic') {
    const data = (await res.json()) as { content: Array<{ text: string }> }
    return data.content[0]?.text ?? ''
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  return data.choices[0]?.message.content ?? ''
}

// ---------------------------------------------------------------------------
// SSE streaming chat
// ---------------------------------------------------------------------------

export async function* chatStream(
  messages: Message[],
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const body = buildBody(messages, opts, true)
  const res = await fetch(endpoint(true), {
    method: 'POST', headers: buildHeaders(),
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI stream error ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res.body) throw new Error('No response body for streaming')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') return

      try {
        const event = JSON.parse(raw)
        if (AI_FORMAT === 'anthropic') {
          if (event.type === 'content_block_delta' && event.delta?.text) yield event.delta.text
          if (event.type === 'message_stop') return
        } else {
          // OpenAI format: choices[0].delta.content
          const content = event.choices?.[0]?.delta?.content
          if (content) yield content
          if (event.choices?.[0]?.finish_reason === 'stop') return
        }
      } catch { /* skip malformed SSE */ }
    }
  }
}
