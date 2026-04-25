import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/http/app'
import {
  fakeAnthropicClient,
  fakeOAuthClient,
  fixedClock,
  inMemoryCredentialStore,
  silentLogger,
  sseStreamResponse,
} from '../helpers/fake-deps'

const NOW = 2_000_000
const VALID_CREDS = {
  type: 'oauth' as const,
  refresh: 'r',
  access: 'access-valid',
  expires: NOW + 60_000,
}

function validAuthedDeps(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const anthropic =
    overrides.anthropic ?? fakeAnthropicClient()
  return {
    anthropic,
    oauth: overrides.oauth ?? fakeOAuthClient(),
    credentialStore:
      overrides.credentialStore ??
      inMemoryCredentialStore({ 'auth:anthropic': VALID_CREDS }),
    clock: overrides.clock ?? fixedClock(NOW),
    logger: overrides.logger ?? silentLogger(),
    getExpectedApiKey: overrides.getExpectedApiKey ?? (() => 'test-key'),
  }
}

describe('POST /v1/chat/completions (integration, in-process)', () => {
  it('returns a 401 when the authorization header does not match', async () => {
    const app = createApp(validAuthedDeps())
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer wrong-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('non-streaming request forwards to anthropic client with OAuth bearer and returns OpenAI-shaped JSON', async () => {
    const anthropic = fakeAnthropicClient({
      onSendMessages: () => ({
        ok: true,
        status: 200,
        headers: {},
        body: null,
        json: {
          id: 'msg_1',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Hello!' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      }),
    })
    const app = createApp(validAuthedDeps({ anthropic }))
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.object).toBe('chat.completion')
    expect(json.choices[0].message.content).toBe('Hello!')
    expect(anthropic.calls).toHaveLength(1)
    expect(anthropic.calls[0].accessToken).toBe('access-valid')
  })

  it('cursor BYOK probe short-circuits without calling anthropic', async () => {
    const anthropic = fakeAnthropicClient()
    const app = createApp(validAuthedDeps({ anthropic }))
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'gpt-4o-2024-08-06',
          messages: [{ role: 'user', content: 'ping' }],
        }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.model).toMatch(/gpt-4o/)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('streaming request: OpenAI-shaped SSE transformation when system lacks claude-code marker', async () => {
    const sse = readFileSync(
      join(__dirname, '..', 'fixtures', 'sse', 'text-reply.sse'),
      'utf8',
    )
    const anthropic = fakeAnthropicClient({
      onSendMessages: () => sseStreamResponse([sse]),
    })
    const app = createApp(validAuthedDeps({ anthropic }))
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('data: ')
    expect(text).toContain('[DONE]')
    // Parse OpenAI chunks out of the SSE transcript.
    const contents: string[] = []
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue
      try {
        const obj = JSON.parse(payload)
        if (obj?.choices?.[0]?.delta?.content) {
          contents.push(obj.choices[0].delta.content)
        }
      } catch {
        // ignore
      }
    }
    expect(contents.join('')).toBe('Hello, world!')
  })

  it('401 from upstream surfaces a friendly auth error', async () => {
    const anthropic = fakeAnthropicClient({
      onSendMessages: () => ({
        ok: false,
        status: 401,
        headers: {},
        body: null,
        errorText: 'expired token',
      }),
    })
    const app = createApp(validAuthedDeps({ anthropic }))
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(401)
    const json = (await res.json()) as any
    expect(json.error).toBe('Authentication failed')
  })

  it('returns 401 when no OAuth credentials are available', async () => {
    const app = createApp(
      validAuthedDeps({
        credentialStore: inMemoryCredentialStore(),
      }),
    )
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('refreshes stale tokens and persists the new credentials', async () => {
    const store = inMemoryCredentialStore({
      'auth:anthropic': {
        type: 'oauth',
        refresh: 'rt-old',
        access: 'access-stale',
        expires: NOW - 1,
      },
    })
    const anthropic = fakeAnthropicClient()
    const oauth = fakeOAuthClient({
      onRefresh: () => ({
        access_token: 'access-new',
        refresh_token: 'rt-new',
        expires_in: 3600,
      }),
    })
    const app = createApp(
      validAuthedDeps({
        credentialStore: store,
        anthropic,
        oauth,
      }),
    )
    await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(anthropic.calls[0].accessToken).toBe('access-new')
    expect(store.data['auth:anthropic'].access).toBe('access-new')
  })
})
