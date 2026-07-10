import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/http/app'
import { resetModelIdCache } from '../../src/http/routes/messages'
import type {
  AnthropicClient,
  AnthropicFetchOptions,
  AnthropicFetchResponse,
} from '../../src/ports/anthropic-client'
import {
  fakeOAuthClient,
  fixedClock,
  inMemoryCredentialStore,
  silentLogger,
} from '../helpers/fake-deps'

const NOW = 2_000_000
const VALID_CREDS = {
  type: 'oauth' as const,
  refresh: 'r',
  access: 'access-valid',
  expires: NOW + 3_600_000,
}
const STALE_CREDS = {
  type: 'oauth' as const,
  refresh: 'rt-old',
  access: 'access-stale',
  expires: NOW - 1,
}

const OK_JSON: AnthropicFetchResponse = {
  ok: true,
  status: 200,
  headers: {},
  body: null,
  json: {
    id: 'msg_1',
    model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  },
}

interface ScriptedClient extends AnthropicClient {
  sendCalls: AnthropicFetchOptions[]
  modelsCalls: number
}

function scriptedClient(opts: {
  responses?: Array<AnthropicFetchResponse | Error>
  fetchModels?: () => unknown
}): ScriptedClient {
  const sendCalls: AnthropicFetchOptions[] = []
  let modelsCalls = 0
  const client: ScriptedClient = {
    sendCalls,
    get modelsCalls() {
      return modelsCalls
    },
    async sendMessages(o) {
      sendCalls.push(o)
      const scripted = opts.responses?.[sendCalls.length - 1] ?? OK_JSON
      if (scripted instanceof Error) throw scripted
      return scripted
    },
    async fetchModels() {
      modelsCalls++
      if (opts.fetchModels) return opts.fetchModels()
      return { anthropic: { models: {} } }
    },
  }
  return client
}

function makeApp(overrides: {
  anthropic: AnthropicClient
  credentialStore?: ReturnType<typeof inMemoryCredentialStore>
  oauth?: ReturnType<typeof fakeOAuthClient>
}) {
  return createApp({
    anthropic: overrides.anthropic,
    oauth: overrides.oauth ?? fakeOAuthClient(),
    credentialStore:
      overrides.credentialStore ??
      inMemoryCredentialStore({ 'auth:anthropic': VALID_CREDS }),
    clock: fixedClock(NOW),
    logger: silentLogger(),
    getExpectedApiKey: () => 'test-key',
  })
}

function chatRequest(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-key',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      ...body,
    }),
  })
}

beforeEach(() => {
  resetModelIdCache()
})

describe('upstream retry', () => {
  it('retries retryable statuses before any bytes are sent, then succeeds', async () => {
    const anthropic = scriptedClient({
      responses: [
        { ok: false, status: 529, headers: {}, body: null, errorText: 'overloaded' },
        { ok: false, status: 500, headers: {}, body: null, errorText: 'ise' },
        OK_JSON,
      ],
    })
    const app = makeApp({ anthropic })
    const res = await app.fetch(chatRequest())
    expect(res.status).toBe(200)
    expect(anthropic.sendCalls).toHaveLength(3)
  })

  it('does not retry non-retryable statuses', async () => {
    const anthropic = scriptedClient({
      responses: [
        { ok: false, status: 400, headers: {}, body: null, errorText: 'bad request' },
      ],
    })
    const app = makeApp({ anthropic })
    const res = await app.fetch(chatRequest())
    expect(res.status).toBe(400)
    expect(anthropic.sendCalls).toHaveLength(1)
  })

  it('retries network errors and gives up after the retry budget', async () => {
    const anthropic = scriptedClient({
      responses: [
        new Error('socket hang up'),
        new Error('socket hang up'),
        new Error('socket hang up'),
      ],
    })
    const app = makeApp({ anthropic })
    const res = await app.fetch(chatRequest())
    expect(res.status).toBe(500)
    expect(anthropic.sendCalls).toHaveLength(3)
  })
})

describe('token caching and single-flight refresh', () => {
  it('refreshes once for concurrent requests with a stale token', async () => {
    let refreshCalls = 0
    const oauth = fakeOAuthClient({
      onRefresh: () => {
        refreshCalls++
        return {
          access_token: 'access-new',
          refresh_token: 'rt-new',
          expires_in: 3600,
        }
      },
    })
    const store = inMemoryCredentialStore({ 'auth:anthropic': STALE_CREDS })
    const anthropic = scriptedClient({})
    const app = makeApp({ anthropic, credentialStore: store, oauth })

    const responses = await Promise.all([
      app.fetch(chatRequest()),
      app.fetch(chatRequest()),
      app.fetch(chatRequest()),
    ])
    for (const res of responses) expect(res.status).toBe(200)
    expect(refreshCalls).toBe(1)
    for (const call of anthropic.sendCalls) {
      expect(call.accessToken).toBe('access-new')
    }
    expect(store.data['auth:anthropic'].access).toBe('access-new')
  })

  it('serves subsequent requests from the in-memory token cache without a store read', async () => {
    const store = inMemoryCredentialStore({ 'auth:anthropic': VALID_CREDS })
    let getCalls = 0
    const countingStore: typeof store = {
      ...store,
      async get(key) {
        getCalls++
        return store.get(key)
      },
    }
    const anthropic = scriptedClient({})
    const app = makeApp({ anthropic, credentialStore: countingStore })

    await app.fetch(chatRequest())
    await app.fetch(chatRequest())
    await app.fetch(chatRequest())
    expect(getCalls).toBe(1)
  })
})

describe('response header pass-through', () => {
  it('does not forward upstream body-framing headers', async () => {
    const anthropic = scriptedClient({
      responses: [
        {
          ...OK_JSON,
          headers: {
            'content-length': '99999',
            'transfer-encoding': 'chunked',
            'content-encoding': 'gzip',
            'request-id': 'req_abc',
          },
        },
      ],
    })
    const app = makeApp({ anthropic })
    const res = await app.fetch(chatRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('request-id')).toBe('req_abc')
    expect(res.headers.get('content-length')).not.toBe('99999')
    expect(res.headers.get('content-encoding')).toBeNull()
  })
})

describe('mid-stream failures', () => {
  it('emits an error chunk and [DONE] when the upstream stream dies midway', async () => {
    const encoder = new TextEncoder()
    const events = [
      'data: {"type":"message_start","message":{"id":"msg_x","model":"claude-sonnet-4-5","usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
    ]
    // Pull-based so both events are actually delivered before the error;
    // controller.error() would discard anything still queued.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = events.shift()
        if (next !== undefined) controller.enqueue(encoder.encode(next))
        else controller.error(new Error('connection reset'))
      },
    })
    const anthropic = scriptedClient({
      responses: [
        {
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body,
        },
      ],
    })
    const app = makeApp({ anthropic })
    const res = await app.fetch(chatRequest({ stream: true }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Hel')
    expect(text).toContain('proxy_stream_error')
    expect(text).toContain('data: [DONE]')
  })
})

describe('model-id catalog resilience', () => {
  it('falls back to static ids when models.dev fails, without refetching per request', async () => {
    const anthropic = scriptedClient({
      fetchModels: () => {
        throw new Error('models.dev unreachable')
      },
    })
    const app = makeApp({ anthropic })

    const first = await app.fetch(chatRequest({ model: 'claude-sonnet-4-5-thinking' }))
    expect(first.status).toBe(200)
    // Suffix normalisation still worked via the static fallback catalog.
    expect(
      (anthropic.sendCalls[0].body as { model: string }).model,
    ).toBe('claude-sonnet-4-5')

    const second = await app.fetch(chatRequest())
    expect(second.status).toBe(200)
    // The failure is negatively cached: no per-request refetch storm.
    expect(anthropic.modelsCalls).toBe(1)
  })
})
