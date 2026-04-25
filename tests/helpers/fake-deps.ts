import type {
  AnthropicClient,
  AnthropicFetchOptions,
  AnthropicFetchResponse,
} from '../../src/ports/anthropic-client'
import type { Clock } from '../../src/ports/clock'
import type {
  CredentialStore,
  OAuthCredentials,
} from '../../src/ports/credential-store'
import type { Logger } from '../../src/ports/logger'
import type { OAuthClient, OAuthTokenResponse } from '../../src/ports/oauth-client'

export function inMemoryCredentialStore(
  initial?: Record<string, OAuthCredentials>,
): CredentialStore & { data: Record<string, OAuthCredentials> } {
  const data: Record<string, OAuthCredentials> = { ...(initial ?? {}) }
  return {
    data,
    async get(key) {
      return data[key] ?? null
    },
    async set(key, creds) {
      data[key] = creds
    },
    async del(key) {
      delete data[key]
    },
  }
}

export function fixedClock(now: number): Clock {
  return { now: () => now }
}

export function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

export interface FakeAnthropicOptions {
  onSendMessages?: (opts: AnthropicFetchOptions) => AnthropicFetchResponse
  models?: unknown
}

export function fakeAnthropicClient(
  opts: FakeAnthropicOptions = {},
): AnthropicClient & { calls: AnthropicFetchOptions[] } {
  const calls: AnthropicFetchOptions[] = []
  return {
    calls,
    async sendMessages(o) {
      calls.push(o)
      if (opts.onSendMessages) return opts.onSendMessages(o)
      return {
        ok: true,
        status: 200,
        headers: {},
        body: null,
        json: {
          id: 'msg_fake',
          model: o.body && typeof o.body === 'object' && 'model' in o.body
            ? (o.body as { model: string }).model
            : 'claude-unknown',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }
    },
    async fetchModels() {
      return opts.models ?? { anthropic: { models: {} } }
    },
  }
}

export interface FakeOAuthOptions {
  onExchange?: (code: string, verifier: string) => OAuthTokenResponse
  onRefresh?: (refresh: string) => OAuthTokenResponse
}

export function fakeOAuthClient(opts: FakeOAuthOptions = {}): OAuthClient {
  return {
    async exchangeCode(code, verifier) {
      if (opts.onExchange) return opts.onExchange(code, verifier)
      return {
        access_token: 'access-' + code,
        refresh_token: 'refresh-' + code,
        expires_in: 3600,
      }
    },
    async refreshToken(refresh) {
      if (opts.onRefresh) return opts.onRefresh(refresh)
      return {
        access_token: 'access-refreshed',
        refresh_token: refresh,
        expires_in: 3600,
      }
    },
  }
}

export function sseStreamResponse(sseBodies: string[]): AnthropicFetchResponse {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const s of sseBodies) {
        controller.enqueue(encoder.encode(s))
      }
      controller.close()
    },
  })
  return {
    ok: true,
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body,
  }
}
