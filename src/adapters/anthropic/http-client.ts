import {
  ANTHROPIC_BETA_HEADER,
  ANTHROPIC_VERSION,
  USER_AGENT,
} from '../../domain/proxy/policies'
import type {
  AnthropicClient,
  AnthropicFetchOptions,
  AnthropicFetchResponse,
} from '../../ports/anthropic-client'

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODELS_URL = 'https://models.dev/api.json'

// Test/dev seam: lets the CLI tests point the adapter at a local fixture
// server instead of hitting models.dev. Production users never set this.
function modelsUrl(): string {
  const override = process.env.CURSOR_CLAUDE_MODELS_URL
  return override && override.length > 0 ? override : DEFAULT_MODELS_URL
}

function collectHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

export function createHttpAnthropicClient(): AnthropicClient {
  return {
    async sendMessages(
      opts: AnthropicFetchOptions,
    ): Promise<AnthropicFetchResponse> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.accessToken}`,
        'anthropic-beta': ANTHROPIC_BETA_HEADER,
        'anthropic-version': ANTHROPIC_VERSION,
        'user-agent': USER_AGENT,
        accept: opts.streaming ? 'text/event-stream' : 'application/json',
        'accept-encoding': 'gzip, deflate',
      }

      const res = await fetch(MESSAGES_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(opts.body),
        signal: opts.signal,
      })

      if (!res.ok) {
        const errorText = await res.text()
        return {
          ok: false,
          status: res.status,
          headers: collectHeaders(res),
          errorText,
          body: null,
        }
      }

      if (opts.streaming) {
        return {
          ok: true,
          status: res.status,
          headers: collectHeaders(res),
          body: res.body,
        }
      }

      const json = (await res.json()) as unknown
      return {
        ok: true,
        status: res.status,
        headers: collectHeaders(res),
        body: null,
        json,
      }
    },

    async fetchModels(): Promise<unknown> {
      const res = await fetch(modelsUrl(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`models.dev request failed (${res.status}): ${text}`)
      }
      return await res.json()
    },
  }
}
