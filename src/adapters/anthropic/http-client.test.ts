import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpAnthropicClient } from './http-client'

describe('createHttpAnthropicClient', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('sendMessages (non-streaming) sets Anthropic headers and returns parsed json', async () => {
    let seenUrl: string | undefined
    let seenInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      seenUrl = String(url)
      seenInit = init
      return new Response(JSON.stringify({ id: 'msg_x', content: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const client = createHttpAnthropicClient()
    const res = await client.sendMessages({
      body: { model: 'claude-sonnet-4-20250514', messages: [] },
      accessToken: 'abc123',
      streaming: false,
    })

    expect(seenUrl).toBe('https://api.anthropic.com/v1/messages')
    const headers = seenInit?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer abc123')
    expect(headers['anthropic-beta']).toContain('oauth-2025-04-20')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.accept).toBe('application/json')
    expect(headers['user-agent']).toMatch(/@anthropic-ai\/sdk/)

    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ id: 'msg_x', content: [] })
  })

  it('sendMessages (streaming) sets SSE accept and returns body stream', async () => {
    globalThis.fetch = vi.fn(async () => {
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('event: ping\n'))
          c.close()
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch

    const client = createHttpAnthropicClient()
    const res = await client.sendMessages({
      body: { model: 'x', messages: [] },
      accessToken: 'tk',
      streaming: true,
    })

    expect(res.ok).toBe(true)
    expect(res.body).not.toBeNull()
  })

  it('sendMessages surfaces 401 with errorText', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('bad token', { status: 401 })
    }) as unknown as typeof fetch

    const client = createHttpAnthropicClient()
    const res = await client.sendMessages({
      body: { model: 'x', messages: [] },
      accessToken: 'tk',
      streaming: false,
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(401)
    expect(res.errorText).toBe('bad token')
  })

  it('fetchModels returns the parsed JSON of models.dev', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ anthropic: { models: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const client = createHttpAnthropicClient()
    const data = await client.fetchModels()
    expect(data).toEqual({ anthropic: { models: {} } })
  })

  it('fetchModels throws on non-OK responses', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('boom', { status: 500 })
    }) as unknown as typeof fetch

    const client = createHttpAnthropicClient()
    await expect(client.fetchModels()).rejects.toThrow(/500/)
  })
})
